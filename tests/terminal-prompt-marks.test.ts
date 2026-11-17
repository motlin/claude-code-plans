import {beforeEach, describe, expect, it, vi} from "vite-plus/test";

vi.mock("../src/lib/terminal-marked-store", () => (
{
	markTerminalCommand: vi.fn<() => void>(),
}));

import {markTerminalCommand} from "../src/lib/terminal-marked-store";
import {createPromptMarks, type PromptMarkTerminal} from "../src/lib/terminal-prompt-marks";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface FakeTerminal extends PromptMarkTerminal
{
	rows: number;
	cols: number;
	viewportY: number;
	scrollback: number;
	cursorY: number;
	type: "normal" | "alternate";
	wrapped: Set<number>;
	calls: string[];
	writes: string[];
	pruned: number;
}

/**
 * A ghostty-web stand-in. Its `write` moves the cursor down a row per line feed, scrolling into the scrollback
 * at the bottom, and prunes `page` rows at once when the scrollback passes `cap`, as ghostty-vt does.
 */
function fakeTerminal({
	rows = 24,
	cap = Infinity,
	page = 40,
}:
{
	rows?: number;
	cap?: number;
	page?: number;
} = {}): FakeTerminal
{
	const term: FakeTerminal =
	{
		rows,
		cols: 80,
		viewportY: 0,
		scrollback: 0,
		cursorY: 0,
		type: "normal",
		wrapped: new Set(),
		calls: [],
		writes: [],
		pruned: 0,
		buffer:
		{
			active:
			{
				get type()
				{
					return term.type;
				},
				get cursorY()
				{
					return term.cursorY;
				},
				getLine: (y) => (
				{
					isWrapped: term.wrapped.has(y),
				}),
			},
		},
		getScrollbackLength: () => (term.type === "normal" ? term.scrollback : 0),
		scrollToLine(line)
		{
			term.calls.push(`line ${line}`);
			term.viewportY = Math.max(0, Math.min(term.scrollback, line));
		},
		scrollToBottom()
		{
			term.calls.push("bottom");
			term.viewportY = 0;
		},
		write(data)
		{
			const text = decoder.decode(data);
			term.writes.push(text);
			if (text === "\u001Bc")
			{
				term.scrollback = 0;
				term.cursorY = 0;
				return;
			}
			if (text === "\u001B[?1049h")
			{
				term.type = "alternate";
				return;
			}
			if (text === "\u001B[?1049l")
			{
				term.type = "normal";
				return;
			}
			for (const char of text)
			{
				if (char !== "\n" || term.type !== "normal") continue;
				if (term.cursorY < term.rows - 1)
				{
					term.cursorY++;
					continue;
				}
				term.scrollback++;
				if (term.scrollback > cap)
				{
					term.scrollback -= page;
					term.pruned += page;
				}
			}
		},
	};
	return term;
}

/** Puts the cursor on absolute row `row`, keeping the scrollback as it is. */
function at(term: FakeTerminal, row: number): void
{
	term.cursorY = row - term.scrollback;
}

function command(marks: ReturnType<typeof createPromptMarks>, term: FakeTerminal, row: number): void
{
	at(term, row);
	marks.onMark("A", undefined);
	marks.onMark("B", undefined);
	marks.onMark("C", "");
}

beforeEach(() =>
{
	vi.mocked(markTerminalCommand).mockClear();
});

describe("createPromptMarks scrollToCommand", () =>
{
	function threeCommands()
	{
		const term = fakeTerminal();
		const marks = createPromptMarks(term);
		for (const row of [0, 5, 9]) command(marks, term, row);
		term.scrollback = 20;
		term.cursorY = 23;
		return {
			term,
			marks,
		};
	}

	it("steps back one command at a time from the bottom, putting each prompt on the top row", () =>
	{
		const {term, marks} = threeCommands();
		const results = [1, 2, 3, 4].map(() => marks.scrollToCommand("previous"));
		expect(
			{
				results,
				calls: term.calls,
			},
		).toStrictEqual(
			{
				results: [true, true, true, true],
				calls: ["line 11", "line 15", "line 20"],
			},
		);
	});

	it("steps forward, then scrolls to the bottom past the last command", () =>
	{
		const {term, marks} = threeCommands();
		term.viewportY = 20;
		const results = [1, 2, 3].map(() => marks.scrollToCommand("next"));
		expect(
			{
				results,
				calls: term.calls,
			},
		).toStrictEqual(
			{
				results: [true, true, true],
				calls: ["line 15", "line 11", "bottom"],
			},
		);
	});

	it("puts the first row of a two-line prompt on top", () =>
	{
		const term = fakeTerminal();
		const marks = createPromptMarks(term);
		at(term, 4);
		marks.onMark("A", undefined);
		at(term, 5);
		marks.onMark("B", undefined);
		marks.onMark("C", "");
		term.scrollback = 20;
		marks.scrollToCommand("previous");
		expect(
			{
				entries: marks.entries,
				calls: term.calls,
			},
		).toStrictEqual(
			{
				entries: [
					{
						row: 5,
						promptLines: 1,
						finished: false,
						exitCode: undefined,
					},
				],
				calls: ["line 16"],
			},
		);
	});

	it("re-anchors the prompt on P;k=i and walks the input row up past soft-wrapped rows", () =>
	{
		const term = fakeTerminal();
		const marks = createPromptMarks(term);
		at(term, 2);
		marks.onMark("A", undefined);
		at(term, 3);
		marks.onMark("P", "k=i");
		at(term, 6);
		term.wrapped.add(6);
		term.wrapped.add(5);
		marks.onMark("B", undefined);
		marks.onMark("C", "");
		expect(marks.entries).toStrictEqual([
			{
				row: 4,
				promptLines: 1,
				finished: false,
				exitCode: undefined,
			},
		]);
	});

	it("leaves the key to the shell when no command is marked, and records nothing on the alternate screen", () =>
	{
		const term = fakeTerminal();
		const marks = createPromptMarks(term);
		const before = marks.scrollToCommand("previous");
		term.type = "alternate";
		command(marks, term, 3);
		expect(
			{
				before,
				after: marks.scrollToCommand("next"),
				entries: marks.entries,
				marked: vi.mocked(markTerminalCommand).mock.calls.length,
			},
		).toStrictEqual(
			{
				before: false,
				after: false,
				entries: [],
				marked: 0,
			},
		);
	});

	it("ignores a C with no prompt mark before it, like upstream", () =>
	{
		const term = fakeTerminal();
		const marks = createPromptMarks(term);
		at(term, 3);
		marks.onMark("C", "");
		expect(marks.entries).toStrictEqual([]);
	});

	it("reset forgets every command", () =>
	{
		const {term, marks} = threeCommands();
		marks.reset();
		expect(
			{
				result: marks.scrollToCommand("previous"),
				entries: marks.entries,
				calls: term.calls,
			},
		).toStrictEqual(
			{
				result: false,
				entries: [],
				calls: [],
			},
		);
	});
});

describe("createPromptMarks entry lifecycle", () =>
{
	function entryAfter(marks: ReturnType<typeof createPromptMarks>, finish: () => void)
	{
		finish();
		return marks.entries.map(({finished, exitCode}) => (
		{
			finished,
			exitCode,
		}));
	}

	it("runs from C until D, keeping the exit code only when it is a number of up to ten digits", () =>
	{
		const term = fakeTerminal();
		const marks = createPromptMarks(term);
		const states = [
			entryAfter(marks, () =>
			{
				command(marks, term, 0);
			}),
			entryAfter(marks, () =>
			{
				marks.onMark("D", "0");
			}),
		];
		for (const [row, code] of [
			[1, "1"],
			[2, "-1"],
			[3, "abc"],
			[4, "12345678901"],
			[5, ""],
			[6, undefined],
		] as const)
		{
			command(marks, term, row);
			marks.onMark("D", code);
		}
		expect(
			{
				states,
				final: marks.entries.map((entry) => entry.exitCode),
				marked: vi.mocked(markTerminalCommand).mock.calls.length,
			},
		).toStrictEqual(
			{
				states: [
					[
						{
							finished: false,
							exitCode: undefined,
						},
					],
					[
						{
							finished: true,
							exitCode: 0,
						},
					],
				],
				final: [0, 1, -1, undefined, undefined, undefined, undefined],
				marked: 7,
			},
		);
	});

	it("finishes a running command with no exit code when the next prompt starts without a D", () =>
	{
		const term = fakeTerminal();
		const marks = createPromptMarks(term);
		command(marks, term, 0);
		at(term, 2);
		marks.onMark("A", undefined);
		expect(marks.entries).toStrictEqual([
			{
				row: 0,
				promptLines: 0,
				finished: true,
				exitCode: undefined,
			},
		]);
	});

	it("ignores a second C while a command runs, and a D with nothing running", () =>
	{
		const term = fakeTerminal();
		const marks = createPromptMarks(term);
		command(marks, term, 0);
		at(term, 3);
		marks.onMark("C", "");
		marks.onMark("D", "0");
		const listener = vi.fn<() => void>();
		marks.subscribe(listener);
		marks.onMark("D", "1");
		expect(
			{
				entries: marks.entries,
				calls: listener.mock.calls.length,
			},
		).toStrictEqual(
			{
				entries: [
					{
						row: 0,
						promptLines: 0,
						finished: true,
						exitCode: 0,
					},
				],
				calls: 0,
			},
		);
	});

	it("replaces a command marked again on the same row", () =>
	{
		const term = fakeTerminal();
		const marks = createPromptMarks(term);
		command(marks, term, 0);
		marks.onMark("D", "1");
		command(marks, term, 4);
		marks.onMark("D", "0");
		command(marks, term, 0);
		expect(marks.entries.map(({row, finished}) => [row, finished])).toStrictEqual([
			[0, false],
			[4, true],
		]);
	});

	it("tells subscribers once per C, D and reset until they unsubscribe", () =>
	{
		const term = fakeTerminal();
		const marks = createPromptMarks(term);
		const listener = vi.fn<() => void>();
		const unsubscribe = marks.subscribe(listener);
		command(marks, term, 0);
		marks.onMark("D", "0");
		marks.reset();
		const counted = listener.mock.calls.length;
		unsubscribe();
		command(marks, term, 2);
		expect(
			{
				counted,
				total: listener.mock.calls.length,
			},
		).toStrictEqual(
			{
				counted: 3,
				total: 3,
			},
		);
	});
});

describe("createPromptMarks write", () =>
{
	it("acts on each mark with the cursor where the bytes before it left it", () =>
	{
		const term = fakeTerminal();
		const marks = createPromptMarks(term);
		marks.write(
			encoder.encode(
				"\n\n\u001B]133;A\u0007$ \u001B]133;B\u0007ls\r\n\u001B]133;C;\u0007a\r\nb\r\n\u001B]133;D;0\u0007",
			),
		);
		expect(
			{
				entries: marks.entries,
				written: term.writes.join(""),
			},
		).toStrictEqual(
			{
				entries: [
					{
						row: 2,
						promptLines: 0,
						finished: true,
						exitCode: 0,
					},
				],
				written:
					"\n\n\u001B]133;A\u0007$ \u001B]133;B\u0007ls\r\n\u001B]133;C;\u0007a\r\nb\r\n\u001B]133;D;0\u0007",
			},
		);
	});

	it("writes at most 32 line feeds at a time", () =>
	{
		const term = fakeTerminal();
		const marks = createPromptMarks(term);
		const text = "x\n".repeat(100);
		marks.write(encoder.encode(text));
		expect(
			{
				joined: term.writes.join(""),
				feeds: term.writes.map((write) => write.split("\n").length - 1),
			},
		).toStrictEqual(
			{
				joined: text,
				feeds: [32, 32, 32, 4],
			},
		);
	});

	it("shifts rows by the scrollback ghostty prunes, dropping the commands pruned away", () =>
	{
		const term = fakeTerminal(
			{
				cap: 60,
				page: 40,
			},
		);
		const marks = createPromptMarks(term);
		for (const row of [0, 30, 50])
		{
			marks.write(encoder.encode("\n".repeat(row - (term.scrollback + term.cursorY))));
			marks.write(encoder.encode("\u001B]133;A\u0007\u001B]133;B\u0007\u001B]133;C\u0007\u001B]133;D;0\u0007"));
		}
		marks.write(encoder.encode("out\n".repeat(70)));
		expect(
			{
				pruned: term.pruned,
				rows: marks.entries.map((entry) => entry.row),
			},
		).toStrictEqual(
			{
				pruned: 40,
				rows: [10],
			},
		);
	});

	it("keeps rows while the alternate screen shows, and drops every command on ESC c", () =>
	{
		const term = fakeTerminal();
		const marks = createPromptMarks(term);
		marks.write(encoder.encode("\u001B]133;A\u0007\u001B]133;B\u0007\u001B]133;C\u0007\n\n"));
		marks.write(encoder.encode("\u001B[?1049h"));
		marks.write(encoder.encode("\n".repeat(40)));
		marks.write(encoder.encode("\u001B[?1049l"));
		const afterAlternate = marks.entries.map((entry) => entry.row);
		marks.write(encoder.encode("\u001Bc"));
		expect(
			{
				afterAlternate,
				afterReset: marks.entries,
			},
		).toStrictEqual(
			{
				afterAlternate: [0],
				afterReset: [],
			},
		);
	});

	it("keeps rows when only the row count changes, and drops them when a column change reflows the buffer", () =>
	{
		const term = fakeTerminal();
		const marks = createPromptMarks(term);
		marks.write(encoder.encode("\n".repeat(30)));
		marks.write(encoder.encode("\u001B]133;A\u0007\u001B]133;B\u0007\u001B]133;C\u0007"));
		term.rows = 30;
		term.scrollback = 1;
		term.cursorY = 29;
		marks.handleResize();
		marks.write(encoder.encode("x"));
		const afterRows = marks.entries.map((entry) => entry.row);
		term.cols = 40;
		marks.handleResize();
		expect(
			{
				afterRows,
				afterCols: marks.entries,
			},
		).toStrictEqual(
			{
				afterRows: [30],
				afterCols: [],
			},
		);
	});
});
