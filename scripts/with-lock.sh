#!/usr/bin/env bash
# Usage: with-lock.sh LOCK_DIR COMMAND [ARGS...]
#
# Runs COMMAND while holding an exclusive lock on LOCK_DIR, waiting for any
# other holder to finish first. `just build` runs under it: `just start` and
# every `git test run` build into the same .output, and two overlapping builds
# fail with ENOTEMPTY or leave readers a half-written tree.
#
# macOS has no flock(1), so the lock is a directory: mkdir is atomic. The
# holder's pid lives in LOCK_DIR/pid; a lock whose holder is no longer alive
# is reclaimed, so a killed build never wedges the next one.
set -euo pipefail

if (($# < 2)); then
	echo "usage: with-lock.sh LOCK_DIR COMMAND [ARGS...]" >&2
	exit 64
fi

lock_dir=$1
shift

release() {
	rm -rf "$lock_dir"
}

waiting=""
until mkdir "$lock_dir" 2>/dev/null; do
	holder=$(cat "$lock_dir/pid" 2>/dev/null || true)
	if [[ -n "$holder" ]] && ! kill -0 "$holder" 2>/dev/null; then
		# Move the stale lock aside first, so a waiter that already reclaimed
		# it and took the lock never has its fresh lock deleted by us.
		stale="$lock_dir.stale.$$"
		if mv "$lock_dir" "$stale" 2>/dev/null; then
			rm -rf "$stale"
		fi
		continue
	fi
	if [[ -z "$waiting" ]]; then
		echo "Waiting for $lock_dir (held by pid ${holder:-unknown})..." >&2
		waiting=1
	fi
	sleep 0.2
done

echo "$$" >"$lock_dir/pid"
trap release EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

"$@"
