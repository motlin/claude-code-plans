const FAILED_COUNT = / \((\d+) failed\)/g;

/**
 * The specimens were read before 2026-11-01, with each segment's failures
 * inline: "Ran 2 commands (1 failed), finished a background command". Since
 * 2026-11-04 upstream joins the outcomes part with ", " (c24951e9f oe/k; live
 * session_01UBegV3NirkewwUuQdFctMg): a header of two or more parts reads "Ran 2
 * commands, finished a background command, 1 failed", totalling every part's
 * failures, while a lone part keeps its count inline. No failed specimen names
 * one file with several verbs ("Read, edited, and created x.ts"), so splitting
 * on ", " counts the parts.
 */
export function withTrailingFailedCount(text: string): string
{
	const counts = [...text.matchAll(FAILED_COUNT)].map((match) => Number(match[1]));
	if (counts.length === 0) return text;
	const stripped = text.replaceAll(FAILED_COUNT, "");
	if (stripped.split(", ").length < 2) return text;
	return `${stripped}, ${counts.reduce((sum, count) => sum + count, 0)} failed`;
}
