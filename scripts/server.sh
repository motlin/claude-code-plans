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
# `restart` reuses the last snapshot. Older snapshots are pruned once the
# server that used them has stopped.
#
# Environment overrides (used by tests/server-lifecycle.test.ts and
# tests/server-snapshot.test.ts):
#   PORT          port to serve on (default 7526)
#   SERVER_CMD    command that launches the server; when set, no snapshot is taken
#                 (default: node SNAPSHOT_ROOT/<id>/.output/server/index.mjs)
#   SNAPSHOT_ROOT where build snapshots live (default: $XDG_CACHE_HOME/claude-code-plans/server-build)
#   SERVER_TITLE  process.title the server sets (src/lib/server-process-title.ts)
#   SERVER_MATCH  pgrep -f pattern identifying server processes
#   PROJECT_DIR   only matched processes with this cwd are managed
#   LOG_FILE      server stdout/stderr log
#   STOP_GRACE_SECONDS  how long stop waits after SIGTERM before force killing (default 10)
#   START_TIMEOUT_SECONDS  how long start waits for the server to answer HTTP (default 20)
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PROJECT_DIR=${PROJECT_DIR:-$(dirname "$SCRIPT_DIR")}
PORT=${PORT:-7526}
SERVER_CMD=${SERVER_CMD:-}
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/claude-code-plans"
SNAPSHOT_ROOT=${SNAPSHOT_ROOT:-"$CACHE_DIR/server-build"}
SERVER_TITLE=${SERVER_TITLE:-claude-code-browser-server}
# The server renames itself to SERVER_TITLE once its Nitro plugins run; the
# command-line alternative catches it before then. macOS pgrep -f sees
# environment data after a rewritten title, hence ( |$) instead of $.
SERVER_MATCH=${SERVER_MATCH:-"^${SERVER_TITLE}( |\$)|\\.output/server/index\\.mjs"}
LOG_FILE=${LOG_FILE:-"$CACHE_DIR/server.log"}
STOP_GRACE_SECONDS=${STOP_GRACE_SECONDS:-10}
START_TIMEOUT_SECONDS=${START_TIMEOUT_SECONDS:-20}

# PIDs listening on the port, including wildcard and IPv6 bindings.
port_pids() {
    if [ "$(uname -s)" = "Darwin" ]; then
        netstat -anv -p tcp | awk -v port="$PORT" \
            '$1 ~ /^tcp/ && $4 ~ ("[.:]" port "$") && $6 == "LISTEN" { print $11 }'
        return
    fi
    lsof -nP -t -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true
}

# PIDs of server processes we own: port holders, plus processes whose command
# line matches SERVER_MATCH and whose cwd is PROJECT_DIR (so other projects'
# servers are left alone). A matched process that already holds the port is
# taken without asking lsof for its cwd: lsof can stall for minutes under load.
server_pids() {
    local pid cwd port_holders
    port_holders=$(port_pids)
    for pid in $(pgrep -f "$SERVER_MATCH" || true); do
        if printf '%s\n' "$port_holders" | grep -qx "$pid"; then
            continue
        fi
        # -b skips lsof's stat of every mount point, which blocks for up to 15s
        # whenever a network mount (an SMB or Time Machine share) is slow.
        cwd=$(lsof -b -w -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1 || true)
        if [ "$cwd" = "$PROJECT_DIR" ]; then
            echo "$pid"
        fi
    done
    if [ -n "$port_holders" ]; then
        echo "$port_holders"
    fi
}

# Which of the given (already vetted) PIDs are still running a server: still
# matched by SERVER_MATCH or still holding the port. Polling this rather than
# server_pids skips the per-pid lsof cwd check. pgrep, unlike kill -0, does
# not count an exited child its parent has yet to reap.
remaining_pids() {
    local running
    running=$({
        pgrep -f "$SERVER_MATCH" || true
        port_pids
    } | sort -u)
    printf '%s\n' "$@" | sort -u | comm -12 - <(printf '%s\n' "$running")
}

dev_server() {
    local pids
    pids=$(port_pids | sort -u)
    if [ -n "$pids" ]; then
        echo "Port $PORT is already in use by pid(s): $pids. Run 'just stop' before 'just dev'." >&2
        return 1
    fi
    if [ "$#" -eq 0 ]; then
        echo "Usage: $0 dev <command> [args...]" >&2
        return 64
    fi
    exec env PORT="$PORT" "$@"
}

stop_server() {
    local pids
    pids=$(server_pids | sort -u)
    if [ -z "$pids" ]; then
        echo "No server running (port $PORT)"
        return 0
    fi
    echo "Stopping server pid(s): $pids"
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    local deadline=$((SECONDS + STOP_GRACE_SECONDS))
    # shellcheck disable=SC2086
    while [ -n "$(remaining_pids $pids)" ] && [ "$SECONDS" -lt "$deadline" ]; do
        sleep 0.2
    done
    # shellcheck disable=SC2086
    pids=$(remaining_pids $pids)
    if [ -n "$pids" ]; then
        echo "Force killing pid(s): $pids"
        # shellcheck disable=SC2086
        kill -9 $pids 2>/dev/null || true
        sleep 0.5
    fi
    pids=$(server_pids | sort -u)
    if [ -n "$pids" ]; then
        echo "Failed to stop server pid(s): $pids" >&2
        return 1
    fi
}

# Copy the worktree's .output into a new snapshot and make it current. The
# copy lands under a temporary name and is renamed into place, so a snapshot
# directory is always complete. APFS clones (cp -c) make the copy near-free.
take_snapshot() {
    local build="$PROJECT_DIR/.output" id tmp
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

# Remove every snapshot except the current one. Only called once the server is
# stopped, so no live process still imports from a pruned snapshot.
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
    local cmd=$SERVER_CMD id=""
    if [ -z "$cmd" ]; then
        if [ "${1:-}" = "fresh" ] || [ -z "$(current_snapshot)" ]; then
            take_snapshot
        fi
        id=$(current_snapshot)
        cmd="node $SNAPSHOT_ROOT/$id/.output/server/index.mjs"
    fi
    stop_server
    if [ -n "$id" ]; then
        prune_snapshots "$id"
    fi
    mkdir -p "$(dirname "$LOG_FILE")"
    (
        cd "$PROJECT_DIR"
        # `exec` so the launched process IS the server, not a wrapper shell
        # that would leave an orphan when killed.
        PORT="$PORT" nohup bash -c "exec $cmd" >>"$LOG_FILE" 2>&1 &
    )
    # A wall-clock deadline rather than an iteration count: on a loaded machine
    # each port check and curl can take seconds of their own.
    local pid deadline=$((SECONDS + START_TIMEOUT_SECONDS))
    while [ "$SECONDS" -lt "$deadline" ]; do
        pid=$(port_pids | head -n 1 || true)
        if [ -n "$pid" ] && curl -sI -o /dev/null --max-time 5 "http://localhost:$PORT/"; then
            echo "Server pid $pid listening on port $PORT (log: $LOG_FILE)"
            return 0
        fi
        sleep 0.2
    done
    echo "Server failed to listen on port $PORT within ${START_TIMEOUT_SECONDS}s; see $LOG_FILE" >&2
    return 1
}

status_server() {
    local pids
    pids=$(server_pids | sort -u)
    if [ -z "$pids" ]; then
        echo "No server running (port $PORT)"
        return 0
    fi
    # shellcheck disable=SC2086
    ps -o pid,ppid,pcpu,etime,command -p $pids
    lsof -iTCP:"$PORT" -sTCP:LISTEN -P -n 2>/dev/null || echo "Port $PORT: no listener"
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
