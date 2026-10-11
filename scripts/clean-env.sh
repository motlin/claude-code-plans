#!/usr/bin/env bash
# Runs a command with only the environment variables the checks, build and tests read.
# vp keys its task cache on the whole environment, and per-process variables such as
# TRACEPARENT, CLAUDE_CODE_SESSION_ID, HERDR_PANE_ID and SHLVL would make every cached run miss.
set -euo pipefail

allowed=(
	HOME PATH TMPDIR USER LANG NO_COLOR FORCE_COLOR
	CI GITHUB_ACTIONS
	XDG_CACHE_HOME XDG_CONFIG_HOME
	PERF_LARGE FULL_JSONL_SCAN CCB_PERF_LOG
	CCB_BUILD_SHA
)

kept=()
for name in "${allowed[@]}"; do
	if [[ -n "${!name+set}" ]]; then
		kept+=("$name=${!name}")
	fi
done

exec env -i "${kept[@]}" "$@"
