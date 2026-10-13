import type {SessionDiffFile} from "../../lib/api/session-diff";

/**
 * Large-diff thresholds. Upstream collapses every file of a large diff but its
 * threshold was not decoded, so these are local picks: more than 100 files or
 * more than 10,000 changed lines (additions + deletions) counts as large.
 */
export const LARGE_DIFF_MAX_FILES = 100;
export const LARGE_DIFF_MAX_LINES = 10_000;

export function isLargeDiff(files: readonly SessionDiffFile[]): boolean {
	if (files.length > LARGE_DIFF_MAX_FILES) return true;
	const lines = files.reduce((sum, file) => sum + file.additions + file.deletions, 0);
	return lines > LARGE_DIFF_MAX_LINES;
}
