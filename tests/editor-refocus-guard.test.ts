// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {focusHeldByField, focusHeldByOverlay, refocusEmptiedEditor} from "../src/lib/editor-refocus-guard";

afterEach(() =>
{
	document.body.innerHTML = "";
	vi.useRealTimers();
});

function setup(html: string): HTMLTextAreaElement
{
	document.body.innerHTML = html;
	const editor = document.querySelector("textarea#editor");
	if (!(editor instanceof HTMLTextAreaElement)) throw new Error("no editor");
	return editor;
}

function focus(selector: string): void
{
	const element = document.querySelector(selector);
	if (!(element instanceof HTMLElement)) throw new Error(`no ${selector}`);
	element.focus();
}

function held(editor: HTMLElement):
{
	overlay: boolean;
	field: boolean;
}
{
	return {
		overlay: focusHeldByOverlay(editor),
		field: focusHeldByField(editor),
	};
}

describe("editor refocus guards (upstream bq / H_)", () =>
{
	it("a focused link holds nothing", () =>
	{
		const editor = setup('<textarea id="editor"></textarea><a id="link" href="#x">x</a>');
		focus("#link");
		expect(held(editor)).toStrictEqual(
			{
				overlay: false,
				field: false,
			},
		);
	});

	it("a button inside a menu is held by the overlay", () =>
	{
		const editor = setup('<textarea id="editor"></textarea><div role="menu"><button id="item">x</button></div>');
		focus("#item");
		expect(held(editor)).toStrictEqual(
			{
				overlay: true,
				field: false,
			},
		);
	});

	it("a dialog that contains the editor does not hold focus", () =>
	{
		const editor = setup('<div role="dialog"><textarea id="editor"></textarea><button id="b">x</button></div>');
		focus("#b");
		expect(held(editor)).toStrictEqual(
			{
				overlay: false,
				field: false,
			},
		);
	});

	it("a visible input holds focus", () =>
	{
		const editor = setup('<textarea id="editor"></textarea><input id="field">');
		focus("#field");
		expect(held(editor)).toStrictEqual(
			{
				overlay: false,
				field: true,
			},
		);
	});

	it("an invisible input does not hold focus", () =>
	{
		const editor = setup('<textarea id="editor"></textarea><input id="field">');
		const field = document.querySelector<HTMLInputElement>("#field");
		if (field === null) throw new Error("no field");
		const checkVisibility = vi.fn<(options?: CheckVisibilityOptions) => boolean>(() => false);
		Object.defineProperty(
			field,
			"checkVisibility",
			{
				value: checkVisibility,
			},
		);
		field.focus();
		expect(
			{
				...held(editor),
				calls: checkVisibility.mock.calls,
			},
		).toStrictEqual(
			{
				overlay: false,
				field: false,
				calls: [
					[
						{
							visibilityProperty: true,
						},
					],
				],
			},
		);
	});

	it("focus on body holds nothing", () =>
	{
		const editor = setup('<textarea id="editor"></textarea>');
		expect(held(editor)).toStrictEqual(
			{
				overlay: false,
				field: false,
			},
		);
	});
});

describe("refocusEmptiedEditor (upstream aY)", () =>
{
	it("takes focus synchronously from a link, caret at the end", () =>
	{
		const editor = setup('<textarea id="editor">abc</textarea><a id="link" href="#x">x</a>');
		editor.setSelectionRange(0, 0);
		focus("#link");
		refocusEmptiedEditor(editor);
		expect(
			{
				focused: document.activeElement === editor,
				start: editor.selectionStart,
				end: editor.selectionEnd,
			},
		).toStrictEqual(
			{
				focused: true,
				start: 3,
				end: 3,
			},
		);
	});

	it("leaves focus in a menu, including after the frame retry", () =>
	{
		vi.useFakeTimers(
			{
				toFake: ["requestAnimationFrame", "cancelAnimationFrame"],
			},
		);
		const editor = setup('<textarea id="editor"></textarea><div role="menu"><button id="item">x</button></div>');
		focus("#item");
		refocusEmptiedEditor(editor);
		const sync = document.activeElement?.id;
		vi.advanceTimersToNextFrame();
		expect(
			{
				sync,
				afterFrame: document.activeElement?.id,
			},
		).toStrictEqual(
			{
				sync: "item",
				afterFrame: "item",
			},
		);
	});

	it("retries once on the next frame when the synchronous focus did not land", () =>
	{
		vi.useFakeTimers(
			{
				toFake: ["requestAnimationFrame", "cancelAnimationFrame"],
			},
		);
		const editor = setup('<textarea id="editor"></textarea><a id="link" href="#x">x</a>');
		focus("#link");
		refocusEmptiedEditor(editor);
		focus("#link");
		vi.advanceTimersToNextFrame();
		expect(document.activeElement === editor).toStrictEqual(true);
	});
});
