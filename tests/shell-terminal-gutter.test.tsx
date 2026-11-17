// @vitest-environment jsdom

import {act, cleanup, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {ShellTerminal} from "../src/components/shell-terminal";
import {TerminalCommandMarks} from "../src/components/terminal-command-marks";
import {encodeTerminalText} from "../src/lib/herdr/terminal-protocol";
import type {GhosttyAppearance} from "../src/lib/server-fns";
import {createPromptMarks, type PromptMarkTerminal} from "../src/lib/terminal-prompt-marks";

const APPEARANCE: GhosttyAppearance =
{
	fontFamily: "monospace",
	fontSize: 13,
	theme:
	{
		background: "#111318",
		foreground: "#e6e6e6",
		red: "#f14c4c",
	},
};

const ghosttyState = vi.hoisted(() => (
{
	pending: false,
	terminals: [] as Array<
	{
		scrollToLine: string[];
		keyHandler: ((event: KeyboardEvent) => boolean) | undefined;
		written: string[];
	}>,
	sockets: [] as EventTarget[],
}));

vi.mock("../src/hooks/use-terminal-theme", () => (
{
	useTerminalTheme: () => (
	{
		ready: true,
		theme: null,
		fontSize: null,
	}),
}));

vi.mock("../src/components/load-ghostty", () => (
{
	loadGhostty: async () =>
	{
		if (ghosttyState.pending) return new Promise(() => {});
		return {
			appearance: APPEARANCE,
			ghostty:
			{
				Terminal: class
				{
					cols = 80;
					rows = 24;
					viewportY = 0;
					renderer =
					{
						charHeight: 17,
					};
					cursorY = 0;
					record: (typeof ghosttyState.terminals)[number] =
					{
						scrollToLine: [],
						keyHandler: undefined,
						written: [],
					};
					buffer =
					{
						active:
						{
							type: "normal",
							getLine: () => undefined,
							cursorY: 0,
						},
					};
					constructor()
					{
						ghosttyState.terminals.push(this.record);
					}
					getScrollbackLength()
					{
						return 0;
					}
					scrollToLine(line: number)
					{
						this.record.scrollToLine.push(String(line));
					}
					scrollToBottom()
					{
						this.record.scrollToLine.push("bottom");
					}
					write(data: Uint8Array | string)
					{
						const text = typeof data === "string" ? data : new TextDecoder().decode(data);
						this.record.written.push(text);
						const feeds = text.split("\n").length - 1;
						this.buffer.active.cursorY += feeds;
					}
					reset()
					{
						this.buffer.active.cursorY = 0;
					}
					onData()
					{
						return {
							dispose()
							{
							},
						};
					}
					onScroll()
					{
						return {
							dispose()
							{
							},
						};
					}
					onResize()
					{
						return {
							dispose()
							{
							},
						};
					}
					attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean)
					{
						this.record.keyHandler = handler;
					}
					loadAddon()
					{
					}
					open()
					{
					}
					dispose()
					{
					}
				},
				FitAddon: class
				{
					fit()
					{
					}
				},
			},
		};
	},
}));

vi.mock("../src/lib/terminal-contrast", () => (
{
	installTerminalContrast: () => () =>
	{
	},
}));

class FakeWebSocket extends EventTarget
{
	static OPEN = 1;
	readyState = 1;
	constructor()
	{
		super();
		ghosttyState.sockets.push(this);
	}
	close()
	{
	}
	send()
	{
	}
}

class FakeResizeObserver
{
	observe()
	{
	}
	disconnect()
	{
	}
}

beforeEach(() =>
{
	ghosttyState.pending = false;
	ghosttyState.terminals = [];
	ghosttyState.sockets = [];
	vi.stubGlobal("WebSocket", FakeWebSocket);
	vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

function renderShell()
{
	return render(
		<ShellTerminal
			sessionId="s"
			ptyKey="k"
			closeRequested={false}
			onClosed={() =>
			{
			}}
			onRestart={async () =>
			{
			}}
		/>,
	);
}

async function flush(): Promise<void>
{
	await act(async () =>
	{
		await new Promise((resolve) =>
		{
			setTimeout(resolve, 0);
		});
	});
}

function receive(frame: object): void
{
	act(() =>
	{
		ghosttyState.sockets.at(-1)?.dispatchEvent(
			new MessageEvent(
				"message",
				{
					data: JSON.stringify(frame),
				},
			),
		);
	});
}

describe("shell terminal gutter geometry", () =>
{
	it("pads the wrapper by pad-md above and below and puts the gutter on the left only, like upstream", () =>
	{
		ghosttyState.pending = true;
		const {container} = renderShell();
		const surface = container.querySelector<HTMLElement>("[data-terminal]");
		const wrapper = surface?.parentElement;
		expect(
			{
				gutter: wrapper?.style.getPropertyValue("--terminal-gutter"),
				wrapperPadding: wrapper?.style.padding,
				surfacePadding: surface?.style.cssText,
				surfaceClasses: surface?.className.split(" "),
			},
		).toStrictEqual(
			{
				gutter: "var(--cds-pad-md)",
				wrapperPadding: "var(--cds-pad-md) 0",
				surfacePadding: "padding-left: var(--terminal-gutter);",
				surfaceClasses: ["min-h-0", "flex-1", "overflow-hidden", "rounded-b-[inherit]"],
			},
		);
	});
});

describe("shell terminal command marks", () =>
{
	const MARKED = "\u001B]133;A\u0007$ \u001B]133;B\u0007ls\r\n\u001B]133;C;\u0007out\r\n\u001B]133;D;1\u0007";

	it("draws a gutter mark for each command the shell marks and scrolls to it on ⌘↓", async () =>
	{
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Macintosh");
		const {container} = renderShell();
		await flush();
		receive(
			{
				type: "opened",
				buffered: encodeTerminalText(`\n\n${MARKED}\n`),
			},
		);
		const marks = [...container.querySelectorAll<HTMLElement>(".xterm-decoration")];
		const terminal = ghosttyState.terminals[0];
		const claimed = terminal?.keyHandler?.(
			new KeyboardEvent(
				"keydown",
				{
					code: "ArrowDown",
					key: "ArrowDown",
					metaKey: true,
				},
			),
		);
		expect(
			{
				marks: marks.map((mark) => [mark.style.top, mark.style.width, mark.style.backgroundColor]),
				claimed,
				scrolled: terminal?.scrollToLine,
				written: terminal?.written.join(""),
			},
		).toStrictEqual(
			{
				marks: [["34px", "3px", "rgb(241, 76, 76)"]],
				claimed: true,
				scrolled: ["-2"],
				written: `\n\n${MARKED}\n`,
			},
		);
	});

	it("rebuilds the marks from the replay when the shell reattaches", async () =>
	{
		const {container} = renderShell();
		await flush();
		receive(
			{
				type: "opened",
				buffered: encodeTerminalText(MARKED),
			},
		);
		receive(
			{
				type: "opened",
				buffered: encodeTerminalText(`\n${MARKED}`),
			},
		);
		expect(
			[...container.querySelectorAll<HTMLElement>(".xterm-decoration")].map((mark) => mark.style.top),
		).toStrictEqual(["17px"]);
	});
});

describe("TerminalCommandMarks", () =>
{
	function fakeTerminal()
	{
		const listeners =
		{
			scroll: new Set<(viewportY: number) => void>(),
			resize: new Set<(size: {cols: number; rows: number}) => void>(),
		};
		const subscribe =
			<T,>(set: Set<(value: T) => void>) =>
			(listener: (value: T) => void) =>
			{
				set.add(listener);
				return {
					dispose: () => set.delete(listener),
				};
			};
		const term =
		{
			rows: 24,
			cols: 80,
			viewportY: 0,
			scrollback: 0,
			cursorY: 3,
			type: "normal" as "normal" | "alternate",
			renderer:
			{
				charHeight: 17,
			},
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
					getLine: () => undefined,
				},
			},
			getScrollbackLength: () => term.scrollback,
			scrollToLine()
			{
			},
			scrollToBottom()
			{
			},
			write()
			{
			},
			onScroll: subscribe(listeners.scroll),
			onResize: subscribe(listeners.resize),
			listeners,
		};
		return term;
	}

	it("draws, restyles, hides and lets go like upstream's decorations", () =>
	{
		const term = fakeTerminal();
		const marks = createPromptMarks(term satisfies PromptMarkTerminal);
		for (const mark of ["A", "B", "C"]) marks.onMark(mark, "");
		const {container, unmount} = render(
			<TerminalCommandMarks marks={marks} terminal={term} theme={APPEARANCE.theme} />,
		);
		const layer = container.firstElementChild;
		const mark = () => container.querySelector<HTMLElement>(".xterm-decoration");
		const running = mark()?.getAttribute("style");
		act(() =>
		{
			marks.onMark("D", "2");
		});
		const failed = mark()?.getAttribute("style");
		term.scrollback = 30;
		act(() =>
		{
			for (const listener of term.listeners.scroll) listener(0);
		});
		const scrolledAway = mark()?.style.display;
		term.scrollback = 0;
		term.type = "alternate";
		act(() =>
		{
			for (const listener of term.listeners.resize)
			{
				listener(
					{
						cols: 80,
						rows: 24,
					},
				);
			}
		});
		const alternate = mark()?.style.display;
		unmount();
		expect(
			{
				layer: [layer?.className, layer?.getAttribute("aria-hidden")],
				running,
				failed,
				scrolledAway,
				alternate,
				listeners: term.listeners.scroll.size + term.listeners.resize.size,
			},
		).toStrictEqual(
			{
				layer: ["xterm-decoration-container", "true"],
				running:
					"display: block; top: 51px; line-height: 17px; pointer-events: none; box-sizing: border-box; width: 5px; height: 5px; margin-top: 6px; margin-left: calc(var(--terminal-gutter, 0px) / -2 - 2.5px); border-radius: 50%; border: 1px solid rgb(230, 230, 230); opacity: 0.5;",
				failed: "display: block; top: 51px; line-height: 17px; pointer-events: none; box-sizing: border-box; width: 3px; height: 17px; margin-top: 0px; margin-left: calc(var(--terminal-gutter, 0px) / -2 - 1.5px); border-radius: 1px; opacity: 1; background-color: rgb(241, 76, 76);",
				scrolledAway: "none",
				alternate: "none",
				listeners: 0,
			},
		);
	});
});
