#!/usr/bin/env bash
# Production server lifecycle for Claude Code Browser.
#
# No launchd service manages this server (removed 2026-05-30), so nothing
# reaps stale processes — this script is the only supervisor. `start` is
# idempotent: it stops any existing server (matched by command line + cwd,
# plus whatever holds the port) before launching a new one, so running it
# twice can never leave two processes behind.
#
# Environment overrides (used by tests/server-lifecycle.test.ts):
#   PORT          port to serve on (default 7526)
#   SERVER_CMD    command that launches the server (default: node .output/server/index.mjs)
#   SERVER_MATCH  pgrep -f pattern identifying server processes
#   PROJECT_DIR   only matched processes with this cwd are managed
#   LOG_FILE      server stdout/stderr log
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PROJECT_DIR=${PROJECT_DIR:-$(dirname "$SCRIPT_DIR")}
PORT=${PORT:-7526}
SERVER_CMD=${SERVER_CMD:-"node .output/server/index.mjs"}
SERVER_MATCH=${SERVER_MATCH:-'\.output/server/index\.mjs'}
LOG_FILE=${LOG_FILE:-"${XDG_CACHE_HOME:-$HOME/.cache}/claude-code-plans/server.log"}

# PIDs listening on the port, including wildcard and IPv6 bindings.
port_pids() {
    lsof -t -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true
}

# PIDs of server processes we own: command line matches SERVER_MATCH and cwd
# is PROJECT_DIR (so other projects' servers are left alone), plus port holders.
server_pids() {
    local pid cwd
    for pid in $(pgrep -f "$SERVER_MATCH" || true); do
        cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1 || true)
        if [ "$cwd" = "$PROJECT_DIR" ]; then
            echo "$pid"
        fi
    done
    port_pids
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
    local i
    for i in $(seq 1 50); do
        pids=$(server_pids | sort -u)
        if [ -z "$pids" ]; then
            return 0
        fi
        sleep 0.2
    done
    echo "Force killing pid(s): $pids"
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
    sleep 0.5
    pids=$(server_pids | sort -u)
    if [ -n "$pids" ]; then
        echo "Failed to stop server pid(s): $pids" >&2
        return 1
    fi
}

start_server() {
    stop_server
    mkdir -p "$(dirname "$LOG_FILE")"
    (
        cd "$PROJECT_DIR"
        # `exec` so the launched process IS the server, not a wrapper shell
        # that would leave an orphan when killed.
        PORT="$PORT" nohup bash -c "exec $SERVER_CMD" >>"$LOG_FILE" 2>&1 &
    )
    local i pid
    for i in $(seq 1 100); do
        pid=$(port_pids | head -n 1 || true)
        if [ -n "$pid" ] && curl -sI -o /dev/null --max-time 5 "http://localhost:$PORT/"; then
            echo "Server pid $pid listening on port $PORT (log: $LOG_FILE)"
            return 0
        fi
        sleep 0.2
    done
    echo "Server failed to listen on port $PORT within 20s; see $LOG_FILE" >&2
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
    start_server
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
