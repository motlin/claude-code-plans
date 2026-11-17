import {type CSSProperties, useEffect, useReducer} from "react";
import {commandMarkStyle} from "../lib/terminal-command-mark-style";
import type {PromptMarks} from "../lib/terminal-prompt-marks";

interface Disposable
{
	dispose(): void;
}

/** The parts of a ghostty-web `Terminal` the gutter marks read. */
export interface CommandMarksTerminal
{
	readonly rows: number;
	/** Lines scrolled up from the bottom (0 = bottom). */
	readonly viewportY: number;
	readonly buffer:
	{
		readonly active:
		{
			readonly type: "normal" | "alternate";
		};
	};
	readonly renderer?:
		|
		  {
				readonly charHeight: number;
		  }
		| undefined;
	getScrollbackLength(): number;
	onScroll(listener: (viewportY: number) => void): Disposable;
	onResize(listener: (size: {cols: number; rows: number}) => void): Disposable;
}

/**
 * Upstream's per-command gutter marks (xterm decorations styled by `hn`), drawn as a DOM layer over
 * ghostty-web's canvas, which has no decorations. Its origin is the canvas's top-left corner: one
 * `--terminal-gutter` in from the shell wrapper's padding box on both axes. Rows off screen, and every row
 * while the alternate screen shows, are hidden as xterm hides them.
 */
export function TerminalCommandMarks({
	marks,
	terminal,
	theme,
}: {
	marks: Pick<PromptMarks, "entries" | "subscribe">;
	terminal: CommandMarksTerminal;
	theme:
	{
		foreground?: string | undefined;
		red?: string | undefined;
	};
})
{
	const [, repaint] = useReducer((tick: number) => tick + 1, 0);

	useEffect(() =>
	{
		const subscriptions = [
			{
				dispose: marks.subscribe(repaint),
			},
			terminal.onScroll(repaint),
			terminal.onResize(repaint),
		];
		return () =>
		{
			for (const subscription of subscriptions) subscription.dispose();
		};
	}, [marks, terminal]);

	const cellHeight = terminal.renderer?.charHeight ?? 0;
	const topRow = terminal.getScrollbackLength() - terminal.viewportY;
	const alternate = terminal.buffer.active.type !== "normal";

	return (
		<div
			aria-hidden="true"
			className="xterm-decoration-container"
			style={
			{
				position: "absolute",
				top: "var(--terminal-gutter)",
				left: "var(--terminal-gutter)",
				pointerEvents: "none",
			}}
		>
			{marks.entries.map((entry) =>
			{
				const screenRow = entry.row - topRow;
				const visible = !alternate && screenRow >= 0 && screenRow < terminal.rows;
				const style: CSSProperties =
				{
					display: visible ? "block" : "none",
					top: `${screenRow * cellHeight}px`,
					lineHeight: `${cellHeight}px`,
					...commandMarkStyle(
						{
							finished: entry.finished,
							exitCode: entry.exitCode,
							lineHeight: cellHeight,
							foreground: theme.foreground,
							red: theme.red,
						},
					),
				};
				return <div key={entry.row} className="xterm-decoration" style={style} />;
			})}
		</div>
	);
}
