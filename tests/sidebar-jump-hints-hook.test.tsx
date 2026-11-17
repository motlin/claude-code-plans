// @vitest-environment jsdom

import {act, cleanup, renderHook} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {useSidebarJumpHints} from "../src/components/sidebar/use-jump-hints";
import {clearJumpHints, jumpHintsByRowKey} from "../src/lib/sidebar-jump-hints";

let clicks: string[] = [];

/** A session column with `count` visible rows, each holding a main-button link. */
function mountList(count: number): HTMLElement
{
	const root = document.createElement("div");
	root.className = "df-session-list contents";
	root.setAttribute("data-kind", "code");
	for (let index = 1; index <= count; index++)
	{
		const row = document.createElement("div");
		row.setAttribute("data-row-key", `s${index}`);
		row.setAttribute("data-jump-hint-row", "");
		Object.defineProperty(
			row,
			"offsetParent",
			{
				get: () => document.body,
			},
		);
		const link = document.createElement("a");
		link.setAttribute("data-row-main-button", "");
		link.addEventListener("click", (event) =>
		{
			event.preventDefault();
			clicks.push(`s${index}`);
		});
		row.append(link);
		root.append(row);
	}
	document.body.append(root);
	return root;
}

function key(type: "keydown" | "keyup", init: KeyboardEventInit): KeyboardEvent
{
	const event = new KeyboardEvent(
		type,
		{
			bubbles: true,
			cancelable: true,
			...init,
		},
	);
	act(() =>
	{
		window.dispatchEvent(event);
	});
	return event;
}

const CTRL =
{
	key: "Control",
	code: "ControlLeft",
	ctrlKey: true,
};
const CTRL_SHIFT =
{
	key: "Shift",
	code: "ShiftLeft",
	ctrlKey: true,
	shiftKey: true,
};

/** Hold Control, then Shift, as a keyboard would report them. */
function holdChord(): void
{
	key("keydown", CTRL);
	key("keydown", CTRL_SHIFT);
}

function digit(n: number, extra: KeyboardEventInit = {}): KeyboardEvent
{
	return key(
		"keydown",
		{
			key: String(n),
			code: `Digit${n}`,
			ctrlKey: true,
			shiftKey: true,
			...extra,
		},
	);
}

function advance(ms: number): void
{
	act(() =>
	{
		vi.advanceTimersByTime(ms);
	});
}

function focus(element: HTMLElement): HTMLElement
{
	document.body.append(element);
	element.focus();
	return element;
}

beforeEach(() =>
{
	vi.useFakeTimers();
	clicks = [];
});

afterEach(() =>
{
	cleanup();
	clearJumpHints();
	vi.useRealTimers();
	document.body.replaceChildren();
});

const THREE =
{
	s1: "1",
	s2: "2",
	s3: "3",
};

describe("useSidebarJumpHints", () =>
{
	it("shows the keycaps only once Ctrl+Shift has been held for 200ms", () =>
	{
		mountList(3);
		renderHook(() =>
		{
			useSidebarJumpHints(true);
		});

		holdChord();
		advance(199);
		const early = jumpHintsByRowKey();
		advance(1);

		expect(
			{
				early,
				shown: jumpHintsByRowKey(),
			},
		).toStrictEqual(
			{
				early: null,
				shown: THREE,
			},
		);
	});

	it("opens row N on a fast Ctrl+Shift+N, before any keycap shows, and claims the key", () =>
	{
		mountList(3);
		renderHook(() =>
		{
			useSidebarJumpHints(true);
		});

		holdChord();
		advance(50);
		const event = digit(2);

		expect(
			{
				clicks,
				prevented: event.defaultPrevented,
				hints: jumpHintsByRowKey(),
			},
		).toStrictEqual(
			{
				clicks: ["s2"],
				prevented: true,
				hints: null,
			},
		);
	});

	it("leaves a digit past the last row alone and hides the keycaps", () =>
	{
		mountList(3);
		renderHook(() =>
		{
			useSidebarJumpHints(true);
		});

		holdChord();
		advance(200);
		const event = digit(7);

		expect(
			{
				clicks,
				prevented: event.defaultPrevented,
				hints: jumpHintsByRowKey(),
			},
		).toStrictEqual(
			{
				clicks: [],
				prevented: false,
				hints: null,
			},
		);
	});

	it("hides on a non-digit key without claiming it, and ignores a repeat", () =>
	{
		mountList(3);
		renderHook(() =>
		{
			useSidebarJumpHints(true);
		});

		holdChord();
		advance(200);
		const repeat = digit(
			1,
			{
				repeat: true,
			},
		);
		const afterRepeat = jumpHintsByRowKey();
		const letter = key(
			"keydown",
			{
				key: "D",
				code: "KeyD",
				ctrlKey: true,
				shiftKey: true,
			},
		);

		expect(
			{
				repeatPrevented: repeat.defaultPrevented,
				afterRepeat,
				letterPrevented: letter.defaultPrevented,
				hints: jumpHintsByRowKey(),
				clicks,
			},
		).toStrictEqual(
			{
				repeatPrevented: false,
				afterRepeat: THREE,
				letterPrevented: false,
				hints: null,
				clicks: [],
			},
		);
	});

	it("hides when Alt joins the chord or a modifier is released, and re-arms while the chord stays down", () =>
	{
		mountList(3);
		renderHook(() =>
		{
			useSidebarJumpHints(true);
		});

		holdChord();
		advance(200);
		key(
			"keydown",
			{
				key: "Alt",
				code: "AltLeft",
				ctrlKey: true,
				shiftKey: true,
				altKey: true,
			},
		);
		const afterAlt = jumpHintsByRowKey();

		holdChord();
		advance(200);
		key(
			"keyup",
			{
				key: "Shift",
				code: "ShiftLeft",
				ctrlKey: true,
			},
		);
		const afterRelease = jumpHintsByRowKey();

		holdChord();
		key(
			"keyup",
			{
				key: "d",
				code: "KeyD",
				ctrlKey: true,
				shiftKey: true,
			},
		);
		advance(200);

		expect(
			{
				afterAlt,
				afterRelease,
				rearmed: jumpHintsByRowKey(),
			},
		).toStrictEqual(
			{
				afterAlt: null,
				afterRelease: null,
				rearmed: THREE,
			},
		);
	});

	it("hides on a mouse move without the chord but keeps them with it, and hides on window blur", () =>
	{
		mountList(3);
		renderHook(() =>
		{
			useSidebarJumpHints(true);
		});

		holdChord();
		advance(200);
		act(() =>
		{
			window.dispatchEvent(
				new MouseEvent(
					"mousemove",
					{
						ctrlKey: true,
						shiftKey: true,
					},
				),
			);
		});
		const withChord = jumpHintsByRowKey();
		act(() =>
		{
			window.dispatchEvent(new MouseEvent("mousemove"));
		});
		const without = jumpHintsByRowKey();

		holdChord();
		advance(200);
		act(() =>
		{
			window.dispatchEvent(new Event("blur"));
		});

		expect(
			{
				withChord,
				without,
				blurred: jumpHintsByRowKey(),
			},
		).toStrictEqual(
			{
				withChord: THREE,
				without: null,
				blurred: null,
			},
		);
	});

	it("stays hidden while a plain input or textarea has focus, but not the composer textarea", () =>
	{
		mountList(3);
		renderHook(() =>
		{
			useSidebarJumpHints(true);
		});

		focus(document.createElement("input"));
		holdChord();
		advance(200);
		const input = jumpHintsByRowKey();

		focus(document.createElement("textarea"));
		holdChord();
		advance(200);
		const textarea = jumpHintsByRowKey();

		const composer = document.createElement("textarea");
		composer.setAttribute("data-jump-hint-passthrough", "");
		focus(composer);
		holdChord();
		advance(200);
		const fromComposer = jumpHintsByRowKey();
		digit(1);

		expect(
			{
				input,
				textarea,
				fromComposer,
				clicks,
			},
		).toStrictEqual(
			{
				input: null,
				textarea: null,
				fromComposer: THREE,
				clicks: ["s1"],
			},
		);
	});

	it("yields to a focused modal menu but not to a non-modal dialog", () =>
	{
		mountList(3);
		renderHook(() =>
		{
			useSidebarJumpHints(true);
		});

		const dialog = document.createElement("div");
		dialog.setAttribute("role", "dialog");
		dialog.setAttribute("aria-modal", "false");
		const inDialog = document.createElement("button");
		dialog.append(inDialog);
		focus(dialog);
		inDialog.focus();
		holdChord();
		advance(200);
		const nonModal = jumpHintsByRowKey();

		const menu = document.createElement("div");
		menu.setAttribute("role", "menu");
		const item = document.createElement("button");
		menu.append(item);
		focus(menu);
		item.focus();
		key(
			"keyup",
			{
				key: "Shift",
				code: "ShiftLeft",
				ctrlKey: true,
			},
		);
		holdChord();
		advance(200);
		const inMenu = jumpHintsByRowKey();
		const event = digit(1);

		expect(
			{
				nonModal,
				inMenu,
				prevented: event.defaultPrevented,
				clicks,
			},
		).toStrictEqual(
			{
				nonModal: THREE,
				inMenu: null,
				prevented: false,
				clicks: [],
			},
		);
	});

	it("never shows or jumps while the sidebar is collapsed", () =>
	{
		mountList(3);
		renderHook(() =>
		{
			useSidebarJumpHints(false);
		});

		holdChord();
		advance(200);
		const event = digit(1);

		expect(
			{
				hints: jumpHintsByRowKey(),
				prevented: event.defaultPrevented,
				clicks,
			},
		).toStrictEqual(
			{
				hints: null,
				prevented: false,
				clicks: [],
			},
		);
	});

	it("hides when the tab is hidden and on unmount", () =>
	{
		mountList(3);
		const {unmount} = renderHook(() =>
		{
			useSidebarJumpHints(true);
		});

		holdChord();
		advance(200);
		act(() =>
		{
			document.dispatchEvent(new Event("visibilitychange"));
		});
		const hidden = jumpHintsByRowKey();
		holdChord();
		advance(200);
		const reshown = jumpHintsByRowKey();
		unmount();

		expect(
			{
				hidden,
				reshown,
				unmounted: jumpHintsByRowKey(),
			},
		).toStrictEqual(
			{
				hidden: null,
				reshown: THREE,
				unmounted: null,
			},
		);
	});
});
