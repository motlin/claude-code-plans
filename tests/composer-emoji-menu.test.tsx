// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeAll, describe, expect, it, vi} from "vite-plus/test";
import {Composer} from "../src/components/composer";
import {preloadComposerSurfaces} from "../src/components/composer-surfaces-entry";
import type {EmojiItem} from "../src/lib/emoji-search";

const RESULTS = vi.hoisted((): Record<string, EmojiItem[]> =>
{
	const item = (name: string, char: string): EmojiItem => (
	{
		name,
		char,
		keywords: [],
	});
	const sm = [
		item("smiley", "\u{1F603}"),
		item("smile", "\u{1F604}"),
		item("smiling_face_with_three_hearts", "\u{1F970}"),
		item("smiling_face_with_tear", "\u{1F972}"),
		item("smirk", "\u{1F60F}"),
		item("smiling_imp", "\u{1F608}"),
		item("smiley_cat", "\u{1F63A}"),
		item("smile_cat", "\u{1F638}"),
	];
	return {
		sm,
		smi: [sm[1], sm[2], sm[3], sm[5]].filter((entry) => entry !== undefined),
		smX: [],
		th: [item("thumbsup", "\u{1F44D}")],
		he: [item("heart", "❤️")],
	};
});

const warmed = vi.hoisted(() => (
{
	count: 0,
}));

vi.mock("../src/lib/emoji-search", () => (
{
	searchEmoji: async (query: string) => Promise.resolve(RESULTS[query] ?? []),
	warmEmoji: () =>
	{
		warmed.count += 1;
	},
}));

beforeAll(async () =>
{
	await preloadComposerSurfaces();
});

afterEach(() =>
{
	cleanup();
	localStorage.clear();
	warmed.count = 0;
});

function renderComposer({
	onShellCommand,
	promptHistory,
}:
{
	onShellCommand?: (command: string) => Promise<boolean>;
	promptHistory?: readonly string[];
} = {}): HTMLTextAreaElement
{
	render(
		<Composer
			variant="session"
			draftKey="session-alice"
			onSend={() =>
			{
			}}
			onShellCommand={onShellCommand}
			promptHistory={promptHistory}
		/>,
	);
	return screen.getByRole<HTMLTextAreaElement>(
		"textbox",
		{
			name: "Prompt",
		},
	);
}

async function type(textarea: HTMLTextAreaElement, value: string, caret = value.length)
{
	await act(async () =>
	{
		fireEvent.change(
			textarea,
			{
				target:
				{
					value,
				},
			},
		);
		textarea.setSelectionRange(caret, caret);
		fireEvent.select(textarea);
		await Promise.resolve();
	});
	// Let the search resolve.
	await act(async () =>
	{
		await new Promise((resolve) =>
		{
			setTimeout(resolve, 0);
		});
	});
}

function listbox(): HTMLElement | null
{
	return screen.queryByRole(
		"listbox",
		{
			name: "Emoji suggestions",
		},
	);
}

function rows()
{
	return screen.getAllByRole("option").map((row) => (
	{
		text: row.textContent,
		selected: row.getAttribute("aria-selected"),
	}));
}

function selectedIndex(): number
{
	return screen.getAllByRole("option").findIndex((row) => row.getAttribute("aria-selected") === "true");
}

function key(textarea: HTMLTextAreaElement, name: string, init: Partial<KeyboardEventInit> = {}): boolean
{
	let notPrevented = true;
	act(() =>
	{
		notPrevented = fireEvent.keyDown(
			textarea,
			{
				key: name,
				...init,
			},
		);
	});
	return notPrevented;
}

describe("Composer : emoji suggestions", () =>
{
	it("warms the table on one character and lists eight rows from two, the first highlighted", async () =>
	{
		const textarea = renderComposer();
		await type(textarea, "hello :s");
		const afterOne =
		{
			open: listbox() !== null,
			warmed: warmed.count > 0,
		};
		await type(textarea, "hello :sm");
		const popup = listbox();
		expect(
			{
				afterOne,
				rows: rows().slice(0, 2),
				count: rows().length,
				dom:
				{
					cds: popup?.getAttribute("data-cds"),
					surface: popup?.getAttribute("data-surface"),
					width: popup?.style.width,
					card: popup?.className.includes("rounded-card bg-surface-3 shadow-panel"),
					controls: textarea.getAttribute("aria-controls") === popup?.id,
					active: textarea.getAttribute("aria-activedescendant") === screen.getAllByRole("option")[0]?.id,
				},
			},
		).toEqual(
			{
				afterOne:
				{
					open: false,
					warmed: true,
				},
				rows: [
					{
						text: "\u{1F603}:smiley:",
						selected: "true",
					},
					{
						text: "\u{1F604}:smile:",
						selected: "false",
					},
				],
				count: 8,
				dom:
				{
					cds: "Surface",
					surface: "popover",
					width: "280px",
					card: true,
					controls: true,
					active: true,
				},
			},
		);
	});

	it("wraps the arrows and accepts with Tab, replacing the token with no trailing space", async () =>
	{
		const textarea = renderComposer();
		await type(textarea, "hello :sm");
		key(textarea, "ArrowUp");
		const afterUp = selectedIndex();
		key(textarea, "ArrowDown");
		key(textarea, "ArrowDown");
		const afterDowns = selectedIndex();
		const tabNotPrevented = key(textarea, "Tab");
		expect(
			{
				afterUp,
				afterDowns,
				tabNotPrevented,
				value: textarea.value,
				caret: textarea.selectionStart,
				open: listbox() !== null,
			},
		).toEqual(
			{
				afterUp: 7,
				afterDowns: 1,
				tabNotPrevented: false,
				value: "hello \u{1F604}",
				caret: 8,
				open: false,
			},
		);
	});

	it("accepts with Enter instead of sending", async () =>
	{
		const textarea = renderComposer();
		await type(textarea, ":th");
		key(textarea, "Enter");
		expect(textarea.value).toBe("\u{1F44D}");
	});

	it("opens only on a : at a line start or after whitespace, with the caret at a word end", async () =>
	{
		const textarea = renderComposer();
		const seen: boolean[] = [];
		for (const [value, caret] of [
			["a:sm", 4],
			[":sm", 3],
			["x\n:th", 5],
			[":smX", 3],
		] as const)
		{
			await type(textarea, value, caret);
			seen.push(listbox() !== null);
		}
		expect(seen).toEqual([false, true, true, false]);
	});

	it("keeps an Escape-dismissed token closed while typing on, and opens a new token", async () =>
	{
		const textarea = renderComposer();
		await type(textarea, "hello :sm");
		const escNotPrevented = key(textarea, "Escape");
		const afterEsc = listbox() !== null;
		await type(textarea, "hello :smi");
		const afterTyping = listbox() !== null;
		await type(textarea, "hello :smi :he");
		expect(
			{
				escNotPrevented,
				afterEsc,
				afterTyping,
				newToken: rows(),
			},
		).toEqual(
			{
				escNotPrevented: false,
				afterEsc: false,
				afterTyping: false,
				newToken: [
					{
						text: "❤️:heart:",
						selected: "true",
					},
				],
			},
		);
	});

	it("resets the highlight to the first row when the rows change", async () =>
	{
		const textarea = renderComposer();
		await type(textarea, "hello :sm");
		key(textarea, "ArrowDown");
		const before = selectedIndex();
		await type(textarea, "hello :smi");
		expect([before, selectedIndex()]).toEqual([1, 0]);
	});

	it("accepts a clicked row, keeps focus on a press inside, and closes on a press outside", async () =>
	{
		const textarea = renderComposer();
		await type(textarea, "hello :sm");
		const insideNotPrevented = fireEvent.mouseDown(screen.getAllByRole("option")[2]!);
		const stillOpen = listbox() !== null;
		act(() =>
		{
			fireEvent.mouseDown(document.body);
		});
		const afterOutside = listbox() !== null;
		await type(textarea, "hello :smi");
		const reopened = listbox() !== null;
		act(() =>
		{
			fireEvent.click(screen.getAllByRole("option")[1]!);
		});
		expect(
			{
				insideNotPrevented,
				stillOpen,
				afterOutside,
				reopened,
				value: textarea.value,
			},
		).toEqual(
			{
				insideNotPrevented: false,
				stillOpen: true,
				afterOutside: false,
				reopened: true,
				value: "hello \u{1F970}",
			},
		);
	});

	it("stays off in bash mode and while a recalled prompt is showing", async () =>
	{
		const textarea = renderComposer(
			{
				onShellCommand: vi.fn<(command: string) => Promise<boolean>>().mockResolvedValue(true),
				promptHistory: ["hello :sm"],
			},
		);
		key(textarea, "ArrowUp");
		await act(async () =>
		{
			textarea.setSelectionRange(9, 9);
			fireEvent.select(textarea);
			await new Promise((resolve) =>
			{
				setTimeout(resolve, 0);
			});
		});
		const recalled =
		{
			value: textarea.value,
			open: listbox() !== null,
		};
		key(textarea, "Escape");
		await type(textarea, "");
		key(textarea, "!");
		await type(textarea, "echo :sm");
		expect(
			{
				recalled,
				bash: listbox() !== null,
			},
		).toEqual(
			{
				recalled:
				{
					value: "hello :sm",
					open: false,
				},
				bash: false,
			},
		);
	});
});
