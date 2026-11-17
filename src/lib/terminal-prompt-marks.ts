import {markTerminalCommand} from "./terminal-marked-store";
import {createPromptMarkSplitter} from "./terminal-osc-filter";

/**
 * Upstream's per-terminal OSC 133 prompt-mark tracker (`gn` in c6bf19e8f), ported from xterm markers to
 * ghostty-web, which has no parser hooks, markers or decorations. Rows are absolute (`0` = the oldest
 * scrollback row, `getScrollbackLength() + cursorY` = the cursor), so the tracker shifts them itself when
 * ghostty prunes scrollback, and drops them when a column change reflows the buffer.
 */

const LINE_FEED = 0x0a;
/**
 * ghostty-vt prunes scrollback a whole page at a time (59 rows at 800 columns, more when narrower). Writing at
 * most this many line feeds per call means every prune shows up as the scrollback shrinking, so it is never
 * hidden inside one write that also grew it.
 */
const MAX_LINE_FEEDS_PER_WRITE = 32;
const EXIT_CODE = /^-?\d{1,10}$/;

export type CommandScrollDirection = "previous" | "next";

export interface PromptMarkTerminal
{
	readonly rows: number;
	readonly cols: number;
	/** ghostty-web: lines scrolled up from the bottom (0 = bottom); fractional while smooth-scrolling. */
	readonly viewportY: number;
	readonly buffer:
	{
		readonly active:
		{
			readonly type: "normal" | "alternate";
			readonly cursorY: number;
			getLine(y: number):
				|
				  {
						readonly isWrapped: boolean;
				  }
				| undefined;
		};
	};
	getScrollbackLength(): number;
	/** ghostty-web: sets `viewportY`, so the top row shown is `getScrollbackLength() - line`. */
	scrollToLine(line: number): void;
	scrollToBottom(): void;
	write(data: Uint8Array): void;
}

export interface PromptMarkEntry
{
	/** Absolute row of the command's input line. */
	readonly row: number;
	/** Rows between the prompt's first line and the input line. */
	readonly promptLines: number;
	readonly finished: boolean;
	readonly exitCode: number | undefined;
}

export interface PromptMarks
{
	/** Writes a chunk to the terminal, acting on each prompt mark once the bytes before it are written. */
	write(chunk: Uint8Array): void;
	/** Handles one OSC 133 sequence; `write` calls it, right after the sequence's terminator is written. */
	onMark(mark: string, arg: string | undefined): void;
	/** Forgets everything, for a terminal that was just reset to replay its buffered output. */
	reset(): void;
	/** Call after the terminal resized: a column change reflows the buffer, so it drops every mark. */
	handleResize(): void;
	/** Upstream `scrollToCommand`: false when there are no marks, so the key falls through to the shell. */
	scrollToCommand(direction: CommandScrollDirection): boolean;
	readonly entries: ReadonlyArray<PromptMarkEntry>;
	/** Fires after marks change, and after writes that move the rows on screen. */
	subscribe(listener: () => void): () => void;
}

interface Marker
{
	row: number;
	disposed: boolean;
}

interface Entry
{
	row: number;
	promptLines: number;
	finished: boolean;
	exitCode: number | undefined;
}

function countLineFeeds(bytes: Uint8Array, start: number, end: number): number
{
	let count = 0;
	for (let index = start; index < end; index++) if (bytes[index] === LINE_FEED) count++;
	return count;
}

export function createPromptMarks(term: PromptMarkTerminal): PromptMarks
{
	let split = createPromptMarkSplitter();
	const entries: Entry[] = [];
	const listeners = new Set<() => void>();
	let promptStart: Marker | undefined;
	let inputStart: Marker | undefined;
	let running: Entry | undefined;
	let lastScrollback = term.getScrollbackLength();
	let lastCursorY = term.buffer.active.cursorY;
	let lastCols = term.cols;
	let lastType = term.buffer.active.type;

	const notify = (): void =>
	{
		for (const listener of listeners) listener();
	};
	const cursorRow = (): number => term.getScrollbackLength() + term.buffer.active.cursorY;
	const removeEntry = (entry: Entry): void =>
	{
		const index = entries.indexOf(entry);
		if (index !== -1) entries.splice(index, 1);
		if (running === entry) running = undefined;
	};
	const disposeAll = (): void =>
	{
		entries.length = 0;
		running = undefined;
		if (promptStart) promptStart.disposed = true;
		if (inputStart) inputStart.disposed = true;
	};

	/** Upstream `o(offset, floor)`: a marker at the cursor row plus `offset`, walked up past soft-wrapped rows. */
	const markerAtCursor = (offset: number, floor: number): Marker =>
	{
		let row = cursorRow() + offset;
		while (row > floor && term.buffer.active.getLine(row)?.isWrapped) row--;
		return {
			row,
			disposed: false,
		};
	};

	const finish = (code: string | undefined): void =>
	{
		const entry = running;
		running = undefined;
		if (!entry) return;
		entry.finished = true;
		entry.exitCode = code !== undefined && EXIT_CODE.test(code) ? Number.parseInt(code, 10) : undefined;
		notify();
	};

	const execute = (): void =>
	{
		if (running) return;
		const start = promptStart;
		let input = inputStart ?? start;
		promptStart = undefined;
		inputStart = undefined;
		const promptLines =
			start && input && !start.disposed && !input.disposed ? Math.max(0, input.row - start.row) : 0;
		if (input?.disposed)
		{
			const row = cursorRow();
			input = markerAtCursor(row > 0 ? -1 : 0, Math.max(0, row - term.rows));
		}
		if (!input) return;
		const row = input.row;
		const index = entries.findLastIndex((entry) => entry.row < row) + 1;
		const sameRow = entries[index];
		if (sameRow?.row === row) removeEntry(sameRow);
		const entry: Entry =
		{
			row,
			promptLines,
			finished: false,
			exitCode: undefined,
		};
		entries.splice(index, 0, entry);
		markTerminalCommand();
		running = entry;
		notify();
	};

	const onMark = (mark: string, arg: string | undefined): void =>
	{
		if (term.buffer.active.type !== "normal") return;
		if (mark === "A")
		{
			finish(undefined);
			promptStart = markerAtCursor(0, cursorRow());
			inputStart = undefined;
		}
		else if (mark === "P" && arg === "k=i" && promptStart)
		{
			promptStart = markerAtCursor(0, cursorRow());
		}
		else if (mark === "B" && promptStart)
		{
			inputStart = markerAtCursor(0, promptStart.disposed ? cursorRow() : promptStart.row);
		}
		else if (mark === "C")
		{
			execute();
		}
		else if (mark === "D")
		{
			finish(arg);
		}
	};

	/** Moves every row up by `count` pruned rows; rows pruned away are gone, like xterm's trimmed markers. */
	const shift = (count: number): void =>
	{
		for (const entry of entries) entry.row -= count;
		for (const entry of entries.filter((candidate) => candidate.row < 0)) removeEntry(entry);
		for (const marker of [promptStart, inputStart])
		{
			if (!marker) continue;
			marker.row -= count;
			if (marker.row < 0) marker.disposed = true;
		}
	};

	const afterWrite = (lineFeeds: number): void =>
	{
		const type = term.buffer.active.type;
		const toggled = type !== lastType;
		lastType = type;
		// The alternate screen reports no scrollback; the normal screen's rows are untouched while it shows.
		if (type !== "normal")
		{
			if (toggled && entries.length > 0) notify();
			return;
		}
		const scrollback = term.getScrollbackLength();
		const cursorY = term.buffer.active.cursorY;
		const moved = toggled || scrollback !== lastScrollback;
		if (scrollback < lastScrollback)
		{
			const scrolled = Math.min(lineFeeds, Math.max(0, lineFeeds - (term.rows - 1 - lastCursorY)));
			shift(lastScrollback - scrollback + scrolled);
		}
		lastScrollback = scrollback;
		lastCursorY = cursorY;
		if (moved && entries.length > 0) notify();
	};

	const writeBytes = (bytes: Uint8Array): void =>
	{
		let start = 0;
		while (start < bytes.length)
		{
			let end = start;
			let lineFeeds = 0;
			while (end < bytes.length && lineFeeds < MAX_LINE_FEEDS_PER_WRITE)
			{
				if (bytes[end] === LINE_FEED) lineFeeds++;
				end++;
			}
			term.write(start === 0 && end === bytes.length ? bytes : bytes.subarray(start, end));
			afterWrite(countLineFeeds(bytes, start, end));
			start = end;
		}
	};

	const resync = (): void =>
	{
		lastCols = term.cols;
		lastType = term.buffer.active.type;
		if (lastType !== "normal") return;
		lastScrollback = term.getScrollbackLength();
		lastCursorY = term.buffer.active.cursorY;
	};

	return {
		write(chunk)
		{
			for (const item of split(chunk))
			{
				if ("bytes" in item)
				{
					writeBytes(item.bytes);
				}
				else if ("mark" in item)
				{
					onMark(item.mark, item.arg);
				}
				else
				{
					disposeAll();
					notify();
				}
			}
		},
		onMark,
		reset()
		{
			split = createPromptMarkSplitter();
			entries.length = 0;
			running = undefined;
			promptStart = undefined;
			inputStart = undefined;
			resync();
			notify();
		},
		handleResize()
		{
			const reflowed = term.cols !== lastCols;
			resync();
			if (!reflowed || entries.length === 0) return;
			disposeAll();
			notify();
		},
		scrollToCommand(direction)
		{
			if (entries.length === 0) return false;
			const scrollback = term.getScrollbackLength();
			const top = (entry: Entry): number => Math.max(0, entry.row - entry.promptLines);
			const currentTop = scrollback - term.viewportY;
			const target =
				direction === "previous"
					? entries.findLast((entry) => top(entry) < currentTop)
					: entries.find((entry) => top(entry) > currentTop);
			if (target) term.scrollToLine(scrollback - top(target));
			else if (direction === "next") term.scrollToBottom();
			return true;
		},
		get entries()
		{
			return entries;
		},
		subscribe(listener)
		{
			listeners.add(listener);
			return () =>
			{
				listeners.delete(listener);
			};
		},
	};
}
