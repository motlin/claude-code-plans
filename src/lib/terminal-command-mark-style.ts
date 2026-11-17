/** Upstream `hn` (c6bf19e8f): the diameter of a command's gutter dot. */
const DOT = 5;
/** Upstream `hn`: the width of a failed command's gutter bar. */
const BAR = 3;

export interface CommandMarkStyleInput
{
	finished: boolean;
	exitCode: number | undefined;
	/** The row height in px; 0 falls back to the dot size, as upstream's `parseFloat(lineHeight) || 5`. */
	lineHeight: number;
	foreground?: string | undefined;
	red?: string | undefined;
}

/**
 * Upstream's per-command gutter mark (`hn`): a hollow ring while the command runs, a filled dot once it
 * finishes, and a red bar the height of the row when it exits nonzero. Centered in the left gutter, which
 * `--terminal-gutter` sizes.
 */
export function commandMarkStyle({
	finished,
	exitCode,
	lineHeight,
	foreground,
	red,
}: CommandMarkStyleInput): Record<string, string>
{
	const failed = exitCode !== undefined && exitCode !== 0;
	const color = (failed ? red : foreground) ?? "currentColor";
	const rowHeight = lineHeight || DOT;
	const width = failed ? BAR : DOT;
	const height = failed ? rowHeight : DOT;
	return {
		pointerEvents: "none",
		boxSizing: "border-box",
		width: `${width}px`,
		height: `${height}px`,
		marginTop: `${(rowHeight - height) / 2}px`,
		marginLeft: `calc(var(--terminal-gutter, 0px) / -2 - ${width / 2}px)`,
		borderRadius: failed ? "1px" : "50%",
		border: finished ? "" : `1px solid ${color}`,
		backgroundColor: finished ? color : "",
		opacity: failed ? "1" : "0.5",
	};
}
