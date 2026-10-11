#!/usr/bin/env bash
# Runs a command with only the environment variables the checks and build read.
# vp check and vp build still fold the whole environment into their cache key, so per-process variables
# such as TRACEPARENT, CLAUDE_CODE_SESSION_ID, HERDR_PANE_ID, CLAUDECODE and COLORTERM would make every
# cached run miss. The test task declares its own env in vite.config.ts and runs without this.
set -euo pipefail

allowed=(
	HOME PATH TMPDIR USER LANG NO_COLOR FORCE_COLOR
	CI GITHUB_ACTIONS
	CCB_BUILD_SHA
)

kept=()
for name in "${allowed[@]}" $(compgen -e XDG_); do
	if [[ -n "${!name+set}" ]]; then
		kept+=("$name=${!name}")
	fi
done

exec env -i "${kept[@]}" "$@"
