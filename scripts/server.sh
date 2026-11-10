#!/usr/bin/env bash
# Production server lifecycle for Claude Code Browser.
#
# No launchd service manages this server (removed 2026-05-30), so nothing
# reaps stale processes — this script is the only supervisor. `start` is
# idempotent: it stops any existing server (matched by command line + cwd,
# plus whatever holds the port) before launching a new one, so running it
# twice can never leave two processes behind.
#
# The server never runs from the worktree's .output: `just precommit` rebuilds
# it in place, and a running server's lazy import()s then hit deleted chunks.
# `start` copies .output into SNAPSHOT_ROOT/<id>/.output and runs from there;
# `restart` reuses the last snapshot. Older snapshots are pruned only once the
# new server answers HTTP; if it never does, the previous snapshot is made
# current again so `restart` brings the last working build back. Each snapshot
# keeps a copy of the previous one's public/assets as .output/previous-assets.
#
# Environment overrides (tests set them through tests/helpers/server-script.ts so
# that no test matches a real server):
#   PORT          port to serve on (default 7526)
#   SERVER_CMD    command that launches the server; when set, no snapshot is taken
#                 (default: node SNAPSHOT_ROOT/<id>/.output/server/index.mjs)
#   SNAPSHOT_ROOT where build snapshots live (default: $XDG_CACHE_HOME/claude-code-plans/server-build)
#   SERVER_TITLE  process.title the server sets (src/lib/server-process-title.ts);
#                 passed to the server, which takes it as its title
#   SERVER_ENTRY_MATCH  pgrep -f pattern for a server's command line before it
#                 renames itself (default: a snapshot under SNAPSHOT_ROOT)
#   SERVER_MATCH  pgrep -f pattern identifying server processes
#                 (default: the SERVER_TITLE title or SERVER_ENTRY_MATCH)
#   PROJECT_DIR   only matched processes with this cwd are managed
#   LOG_FILE      server stdout/stderr log
#   STOP_GRACE_SECONDS  how long stop waits after SIGTERM before force killing (default 10)
#   START_TIMEOUT_SECONDS  how long start waits for the server to answer HTTP (default 60;
#                 start returns as soon as it answers, or as soon as it exits)
#   LOOKUP_TIMEOUT_SECONDS  how long each process, port or cwd lookup may take; one that
#                 overruns is killed and the command fails rather than report no server (default 15)
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PROJECT_DIR=${PROJECT_DIR:-$(dirname "$SCRIPT_DIR")}
PORT=${PORT:-7526}
SERVER_CMD=${SERVER_CMD:-}
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/claude-code-plans"
SNAPSHOT_ROOT=${SNAPSHOT_ROOT:-"$CACHE_DIR/server-build"}
SERVER_TITLE=${SERVER_TITLE:-claude-code-browser-server}
# The server renames itself to SERVER_TITLE once its Nitro plugins run; the
# command-line alternative catches it before then. It names this script's own
# snapshots by absolute path rather than any .output/server/index.mjs, so other
# projects' servers are never candidates (each candidate costs a cwd
# lookup). macOS pgrep -f sees environment data after a rewritten title, hence
# ( |$) instead of $.
SERVER_ENTRY_MATCH=${SERVER_ENTRY_MATCH:-"$(printf '%s' "$SNAPSHOT_ROOT" | sed 's/[][\\.*^$+?(){}|]/\\&/g')/[^/]+/\\.output/server/index\\.mjs"}
SERVER_MATCH=${SERVER_MATCH:-"^${SERVER_TITLE}( |\$)|${SERVER_ENTRY_MATCH}"}
LOG_FILE=${LOG_FILE:-"$CACHE_DIR/server.log"}
STOP_GRACE_SECONDS=${STOP_GRACE_SECONDS:-10}
START_TIMEOUT_SECONDS=${START_TIMEOUT_SECONDS:-60}
LOOKUP_TIMEOUT_SECONDS=${LOOKUP_TIMEOUT_SECONDS:-15}
OS=$(uname -s)

# Each lookup reports its exit status on one FIFO, opened read-write on fd 3
# and unlinked at once so nothing needs cleaning up; read -t then waits for a
# lookup without polling (each poll's sleep costs a fork under load).
lookup_fifo_dir=$(mktemp -d)
mkfifo "$lookup_fifo_dir/done"
exec 3<>"$lookup_fifo_dir/done"
rm -f "$lookup_fifo_dir/done"
rmdir "$lookup_fifo_dir"

# `bounded <what> <command> [args...]` runs a lookup, printing its stdout and
# returning its status. One still running after LOOKUP_TIMEOUT_SECONDS is
# killed and reported as an error (status 124), never as an empty answer: a
# stalled lookup must not read as "no server".
bounded() {
    local what=$1 out job status
    shift
    out=$(mktemp)
    # Job control gives the lookup its own process group, so a timeout kills
    # the command along with the subshell waiting on it.
    set -m
    {
        "$@" >"$out" 2>/dev/null
        echo "$?" >&3
    } &
    job=$!
    set +m
    if ! read -r -t "$LOOKUP_TIMEOUT_SECONDS" -u 3 status; then
        # No wait afterwards: a command blocked in the kernel (a hung NFS or SMB
        # mount) cannot die until that call returns, and waiting would hang
        # with it. disown keeps bash from reporting the kill.
        kill -9 -- -"$job" 2>/dev/null || true
        disown "$job" 2>/dev/null || true
        rm -f "$out"
        echo "$what did not finish within ${LOOKUP_TIMEOUT_SECONDS}s" >&2
        return 124
    fi
    wait "$job" 2>/dev/null || true
    cat "$out"
    rm -f "$out"
    return "$status"
}

# PIDs whose command line matches SERVER_MATCH. pgrep exits 1 when none do.
matched_pids() {
    local status=0
    bounded "Looking up processes matching SERVER_MATCH" pgrep -f "$SERVER_MATCH" || status=$?
    [ "$status" -le 1 ]
}

# PIDs listening on the port, including wildcard and IPv6 bindings. Never
# lsof -i on macOS: it stats every mount point, and one call took 51s with
# slow SMB/NFS mounts under load.
port_pids() {
    local status=0
    if [ "$OS" = "Darwin" ]; then
        bounded "Looking up port $PORT's listeners" netstat -anv -p tcp | awk -v port="$PORT" \
            '$1 ~ /^tcp/ && $4 ~ ("[.:]" port "$") && $6 == "LISTEN" { print $11 }'
        return
    fi
    # -b skips the mount-point stats; lsof exits 1 when nothing listens.
    bounded "Looking up port $PORT's listeners" lsof -b -w -nP -t -iTCP:"$PORT" -sTCP:LISTEN || status=$?
    [ "$status" -le 1 ]
}

# "<pid>\t<cwd>" for each given PID whose cwd can be read. On macOS one libproc
# proc_pidinfo(PROC_PIDVNODEPATHINFO) call per PID (the proc_info syscall, 336,
# through perl, which macOS always ships): unlike lsof it never scans the
# process table or stats mount points. On Linux, /proc/<pid>/cwd.
read_cwds() {
    if [ "$OS" = "Darwin" ]; then
        perl -e 'for my $pid (@ARGV) {
            my $info = "\0" x 2352;
            next unless syscall(336, 2, $pid + 0, 9, 0, $info, 2352) == 2352;
            print "$pid\t", unpack("Z*", substr($info, 152, 1024)), "\n";
        }' "$@"
        return
    fi
    local pid cwd
    for pid in "$@"; do
        if cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null); then
            printf '%s\t%s\n' "$pid" "$cwd"
        fi
    done
}

# PIDs of server processes we own: port holders, plus processes whose command
# line matches SERVER_MATCH and whose cwd is PROJECT_DIR (so other projects'
# servers are left alone). A matched process that already holds the port is
# taken without reading its cwd. Fails if any lookup fails or times out.
server_pids() {
    local pid port_holders matched candidates=()
    port_holders=$(port_pids) || return 1
    matched=$(matched_pids) || return 1
    for pid in $matched; do
        if ! printf '%s\n' "$port_holders" | grep -qx "$pid"; then
            candidates+=("$pid")
        fi
    done
    if [ "${#candidates[@]}" -gt 0 ]; then
        pids_in_project_dir "${candidates[@]}" || return 1
    fi
    if [ -n "$port_holders" ]; then
        echo "$port_holders"
    fi
}

# Which of the given PIDs have PROJECT_DIR as their cwd.
pids_in_project_dir() {
    local cwds
    cwds=$(bounded "Reading the cwd of pid(s) $*" read_cwds "$@") || return 1
    printf '%s\n' "$cwds" | awk -F '\t' -v dir="$PROJECT_DIR" '$2 == dir { print $1 }'
}

# Which of the given (already vetted) PIDs are still running a server: still
# matched by SERVER_MATCH or still holding the port. Polling this rather than
# server_pids skips the per-pid cwd check. pgrep, unlike kill -0, does
# not count an exited child its parent has yet to reap.
remaining_pids() {
    local matched holders running
    matched=$(matched_pids) || return 1
    holders=$(port_pids) || return 1
    running=$(printf '%s\n%s\n' "$matched" "$holders" | sort -u)
    printf '%s\n' "$@" | sort -u | comm -12 - <(printf '%s\n' "$running")
}

dev_server() {
    local pids
    pids=$(port_pids | sort -u) || return 1
    if [ -n "$pids" ]; then
        echo "Port $PORT is already in use by pid(s): $pids. Run 'just stop' before 'just dev'." >&2
        return 1
    fi
    if [ "$#" -eq 0 ]; then
        echo "Usage: $0 dev <command> [args...]" >&2
        return 64
    fi
    exec 3>&-
    exec env PORT="$PORT" "$@"
}

# A failed lookup stops nothing and fails: it must never read as "no server".
lookup_failed() {
    echo "Could not tell which server processes are running; $1" >&2
    return 1
}

stop_server() {
    local pids
    pids=$(server_pids | sort -u) || lookup_failed "stopped nothing" || return 1
    if [ -z "$pids" ]; then
        echo "No server running (port $PORT)"
        return 0
    fi
    echo "Stopping server pid(s): $pids"
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    local remaining deadline=$((SECONDS + STOP_GRACE_SECONDS))
    while true; do
        # shellcheck disable=SC2086
        remaining=$(remaining_pids $pids) || lookup_failed "sent SIGTERM to pid(s) $pids" || return 1
        if [ -z "$remaining" ] || [ "$SECONDS" -ge "$deadline" ]; then
            break
        fi
        sleep 0.2
    done
    pids=$remaining
    if [ -n "$pids" ]; then
        echo "Force killing pid(s): $pids"
        # shellcheck disable=SC2086
        kill -9 $pids 2>/dev/null || true
        sleep 0.5
    fi
    pids=$(server_pids | sort -u) || lookup_failed "could not confirm the stop" || return 1
    if [ -n "$pids" ]; then
        echo "Failed to stop server pid(s): $pids" >&2
        return 1
    fi
}

# Copy the worktree's .output into a new snapshot and make it current. The
# copy lands under a temporary name and is renamed into place, so a snapshot
# directory is always complete. APFS clones (cp -c) make the copy near-free.
take_snapshot() {
    local build="$PROJECT_DIR/.output" id tmp previous previous_assets
    if [ ! -f "$build/server/index.mjs" ]; then
        echo "No build at $build; run 'just build' first" >&2
        return 1
    fi
    id="$(date +%Y%m%dT%H%M%S)-$$"
    tmp="$SNAPSHOT_ROOT/$id.tmp"
    mkdir -p "$tmp"
    if ! cp -cR "$build" "$tmp/" 2>/dev/null; then
        rm -rf "$tmp"
        mkdir -p "$tmp"
        cp -R "$build" "$tmp/"
    fi
    # Tabs still open from the previous build lazily import its hashed chunks;
    # server/routes/assets serves them from previous-assets after a deploy.
    # One generation only: the previous snapshot's own previous-assets is dropped.
    previous=$(current_snapshot)
    previous_assets="$SNAPSHOT_ROOT/$previous/.output/public/assets"
    if [ -n "$previous" ] && [ -d "$previous_assets" ]; then
        if ! cp -cR "$previous_assets" "$tmp/.output/previous-assets" 2>/dev/null; then
            rm -rf "$tmp/.output/previous-assets"
            cp -R "$previous_assets" "$tmp/.output/previous-assets"
        fi
    fi
    mv "$tmp" "$SNAPSHOT_ROOT/$id"
    printf '%s\n' "$id" >"$SNAPSHOT_ROOT/current.tmp"
    mv -f "$SNAPSHOT_ROOT/current.tmp" "$SNAPSHOT_ROOT/current"
}

current_snapshot() {
    local id
    id=$(cat "$SNAPSHOT_ROOT/current" 2>/dev/null || true)
    if [ -n "$id" ] && [ -f "$SNAPSHOT_ROOT/$id/.output/server/index.mjs" ]; then
        echo "$id"
    fi
}

# Remove every snapshot except the current one. Only called once the new server
# is listening (the old one is stopped by then), so no live process still
# imports from a pruned snapshot.
prune_snapshots() {
    local keep=$1 entry
    for entry in "$SNAPSHOT_ROOT"/*; do
        if [ -d "$entry" ] && [ "$(basename "$entry")" != "$keep" ]; then
            rm -rf "$entry"
        fi
    done
}

# `start_server fresh` snapshots the current build first; otherwise the last
# snapshot is reused, and one is taken only if none exists yet.
start_server() {
    local cmd=$SERVER_CMD id="" previous=""
    if [ -z "$cmd" ]; then
        previous=$(current_snapshot)
        if [ "${1:-}" = "fresh" ] || [ -z "$previous" ]; then
            take_snapshot
        fi
        id=$(current_snapshot)
        cmd="node $SNAPSHOT_ROOT/$id/.output/server/index.mjs"
    fi
    stop_server || return 1
    mkdir -p "$(dirname "$LOG_FILE")"
    touch "$LOG_FILE"
    # Where this launch's output starts, so an early exit can show just that.
    local log_offset
    log_offset=$(wc -c <"$LOG_FILE" | tr -d ' ')
    # Job control puts the launched job in its own process group (pgid = $!),
    # so the liveness check below covers the server even when SERVER_CMD is a
    # launcher that forks it and exits. It also keeps a terminal's Ctrl-C from
    # reaching the server.
    set -m
    (
        cd "$PROJECT_DIR"
        exec 3>&-
        # No HOST: one socket cannot bind both 127.0.0.1 (Caddy's upstream) and
        # [::1] (local browsers), so Nitro listens on every interface and
        # server/middleware/loopback-only.ts 403s any non-loopback peer.
        # `exec` (both here and in bash -c) so the launched process IS the
        # server, not a wrapper shell that would leave an orphan when killed.
        PORT="$PORT" SERVER_TITLE="$SERVER_TITLE" exec nohup bash -c "exec $cmd"
    ) </dev/null >>"$LOG_FILE" 2>&1 &
    local launched=$!
    set +m
    # A wall-clock deadline rather than an iteration count: on a loaded machine
    # each port check and curl can take seconds of their own, and the server
    # itself can take tens of seconds to bind. The deadline is generous because
    # the loop exits as soon as the server answers, or as soon as it dies.
    local pid deadline=$((SECONDS + START_TIMEOUT_SECONDS))
    while [ "$SECONDS" -lt "$deadline" ]; do
        # The whole process group, not just $launched: only when every process
        # of the launch is gone has the server really exited.
        if ! kill -0 -- -"$launched" 2>/dev/null; then
            echo "Server exited before listening on port $PORT; see $LOG_FILE" >&2
            tail -c +$((log_offset + 1)) "$LOG_FILE" | tail -n 20 >&2
            restore_previous_snapshot "$previous" "$id"
            return 1
        fi
        pid=$(port_pids | head -n 1 || true)
        if [ -n "$pid" ] && curl -sI -o /dev/null --max-time 5 "http://localhost:$PORT/"; then
            echo "Server pid $pid listening on port $PORT (log: $LOG_FILE)"
            if [ -n "$id" ]; then
                prune_snapshots "$id"
            fi
            return 0
        fi
        sleep 0.2
    done
    echo "Server failed to listen on port $PORT within ${START_TIMEOUT_SECONDS}s; see $LOG_FILE" >&2
    restore_previous_snapshot "$previous" "$id"
    return 1
}

# After a failed start, make the last working snapshot current again.
restore_previous_snapshot() {
    local previous=$1 id=$2
    if [ -n "$previous" ] && [ "$previous" != "$id" ]; then
        printf '%s\n' "$previous" >"$SNAPSHOT_ROOT/current.tmp"
        mv -f "$SNAPSHOT_ROOT/current.tmp" "$SNAPSHOT_ROOT/current"
        echo "Kept snapshot $previous current; 'just restart' serves it again" >&2
    fi
}

status_server() {
    local pids
    pids=$(server_pids | sort -u) || lookup_failed "no status" || return 1
    if [ -z "$pids" ]; then
        echo "No server running (port $PORT)"
        return 0
    fi
    # shellcheck disable=SC2086
    ps -o pid,ppid,pcpu,etime,command -p $pids
    # port_pids, not lsof -i: lsof stats every mount and stalls on a slow one.
    local listeners
    listeners=$(port_pids | sort -u | paste -sd ' ' -) || return 1
    echo "Port $PORT: ${listeners:-no listener}"
}

case "${1:-}" in
dev)
    shift
    dev_server "$@"
    ;;
start)
    start_server fresh
    ;;
stop)
    stop_server
    ;;
restart)
    start_server
    ;;
status)
    status_server
    ;;
*)
    echo "Usage: $0 {dev <command> [args...]|start|stop|restart|status}" >&2
    exit 64
    ;;
esac
