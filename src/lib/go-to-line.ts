export interface GoToLineTarget
{
	line: number;
	column?: number;
}

/**
 * Upstream `Tc`: the go to line bar's `line` or `line:column`, with the line inside the file's
 * `lines`. Null for anything else, including empty text (which the bar does not mark invalid).
 */
export function parseGoToLine(text: string, lines: number): GoToLineTarget | null
{
	const match = /^(\d+)(?::(\d+))?$/.exec(text.trim());
	if (match === null) return null;
	const line = Number(match[1]);
	if (!Number.isSafeInteger(line) || line < 1 || line > lines) return null;
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
