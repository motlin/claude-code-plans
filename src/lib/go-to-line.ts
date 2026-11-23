export interface GoToLineTarget
{
	line: number;
	column?: number;
}

/**
 * Upstream `Tc`: the go to line bar's `line` or `line:column`, with the line clamped into the file's
 * `1..lines` as upstream does. Null for anything else, including empty text (which the bar does not
 * mark invalid).
 */
export function parseGoToLine(text: string, lines: number): GoToLineTarget | null
{
	const match = /^(\d+)(?::(\d+))?$/.exec(text.trim());
	if (match === null) return null;
	const line = Math.min(Math.max(Number(match[1]), 1), lines);
	if (match[2] === undefined)
		return {
			line,
		};
	const column = Number(match[2]);
	if (!Number.isSafeInteger(column) || column < 1) return null;
	return {
		line,
		column,
	};
}
