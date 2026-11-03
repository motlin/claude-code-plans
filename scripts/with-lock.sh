#!/usr/bin/env bash
# Usage: with-lock.sh LOCK_DIR COMMAND [ARGS...]
#
# Runs COMMAND while holding an exclusive lock on LOCK_DIR, waiting for any
# other holder to finish first. `just build` runs under it: `just start` and
# every `git test run` build into the same .output, and two overlapping builds
# fail with ENOTEMPTY or leave readers a half-written tree.
#
# The lock is a kernel flock(2) on LOCK_DIR/lock, held through this shell's
# fd 9. macOS has no flock(1), so perl takes it on the shared fd; the lock
# belongs to the open file, so it stays held after perl exits and is dropped
# by the kernel the moment this shell dies, however it dies. No pid checks or
# stale-lock reclaiming: those raced, letting two waiters in at once.
# LOCK_DIR/pid names the holder for the waiting message only.
set -euo pipefail

if (($# < 2)); then
	echo "usage: with-lock.sh LOCK_DIR COMMAND [ARGS...]" >&2
	exit 64
fi

lock_dir=$1
shift

mkdir -p "$lock_dir"
exec 9>>"$lock_dir/lock"

flock_fd9() {
	perl -MFcntl=:flock -e 'open(my $fh, ">&=", 9) or die "with-lock.sh: fd 9: $!\n"; flock($fh, $ARGV[0] ? LOCK_EX : LOCK_EX | LOCK_NB) or exit 75' "$1"
}

if ! flock_fd9 0; then
	echo "Waiting for $lock_dir (held by pid $(cat "$lock_dir/pid" 2>/dev/null || echo unknown))..." >&2
	flock_fd9 1
fi
echo "$$" >"$lock_dir/pid"

# Not the last command, so bash never execs it in place of this shell, and
# without fd 9, so a daemon it leaves behind can't hold the lock forever.
status=0
"$@" 9>&- || status=$?
exit "$status"
