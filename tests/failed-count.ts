const FAILED_COUNT = / \((\d+) failed\)/g;

/**
 * The specimens were read before upstream moved failures out of the phrases
 * (2026-11-01): "Ran 2 commands (1 failed), finished a background command" now
 * draws as "Ran 2 commands, finished a background command (1 failed)", one
 * trailing count totalling every segment's.
 */
export function withTrailingFailedCount(text: string): string {
	const counts = [...text.matchAll(FAILED_COUNT)].map((match) => Number(match[1]));
	if (counts.length === 0) return text;
	return `${text.replaceAll(FAILED_COUNT, "")} (${counts.reduce((sum, count) => sum + count, 0)} failed)`;
}
