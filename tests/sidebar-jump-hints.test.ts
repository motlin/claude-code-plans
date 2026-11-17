// @vitest-environment jsdom

import {afterEach, describe, expect, it} from "vite-plus/test";

import
{
	assignJumpHints,
	clearJumpHints,
	collectJumpRows,
	isJumpChord,
	isJumpGatedFocus,
	jumpKeyOf,
	jumpRowKeyFor,
	showJumpHints,
	subscribeJumpHints,
} from "../src/lib/sidebar-jump-hints";

/** jsdom has no layout: offsetParent is always null, so stub it per row. */
function row(key: string, visible = true): HTMLElement
{
	const element = document.createElement("div");
	element.setAttribute("data-row-key", key);
	element.setAttribute("data-jump-hint-row", "");
	Object.defineProperty(
		element,
		"offsetParent",
		{
			get: () => (visible ? document.body : null),
		},
	);
	return element;
}

function list(...rows: HTMLElement[]): HTMLElement
{
	const root = document.createElement("div");
	root.append(...rows);
	document.body.append(root);
	return root;
}

function element(tag: string, attrs: Record<string, string> = {}): HTMLElement
{
	const node = document.createElement(tag);
	for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
	return node;
}

function modifiers(ctrlKey: boolean, shiftKey: boolean, metaKey: boolean, altKey: boolean)
{
	return {
		ctrlKey,
		shiftKey,
		metaKey,
		altKey,
	};
}

afterEach(() =>
{
	clearJumpHints();
	document.body.replaceChildren();
});

describe("sidebar jump hints model", () =>
{
	it("gates focus in inputs, textareas and selects, but not the composer passthrough, contenteditable or buttons", () =>
	{
		expect(
			{
				input: isJumpGatedFocus(element("input")),
				textarea: isJumpGatedFocus(element("textarea")),
				select: isJumpGatedFocus(element("select")),
				composer: isJumpGatedFocus(
					element(
						"textarea",
						{
							"data-jump-hint-passthrough": "",
						},
					),
				),
				contenteditable: isJumpGatedFocus(
					element(
						"div",
						{
							contenteditable: "true",
						},
					),
				),
				button: isJumpGatedFocus(element("button")),
				none: isJumpGatedFocus(null),
			},
		).toStrictEqual(
			{
				input: true,
				textarea: true,
				select: true,
				composer: false,
				contenteditable: false,
				button: false,
				none: false,
			},
		);
	});

	it("is the chord only for exactly Ctrl+Shift", () =>
	{
		expect([
			isJumpChord(modifiers(true, true, false, false)),
			isJumpChord(modifiers(true, true, false, true)),
			isJumpChord(modifiers(true, true, true, false)),
			isJumpChord(modifiers(true, false, false, false)),
			isJumpChord(modifiers(false, true, false, false)),
		]).toStrictEqual([true, false, false, false, false]);
	});

	it("maps keys by code, independent of layout", () =>
	{
		expect([
			jumpKeyOf(
				{
					code: "Digit3",
					key: "#",
				},
			),
			jumpKeyOf(
				{
					code: "KeyD",
					key: "D",
				},
			),
			jumpKeyOf(
				{
					code: "KeyQ",
					key: "a",
				},
			),
			jumpKeyOf(
				{
					code: "ShiftLeft",
					key: "Shift",
				},
			),
			jumpKeyOf(
				{
					code: "Semicolon",
					key: "x",
				},
			),
		]).toStrictEqual(["3", "d", "a", null, "x"]);
	});

	it("numbers the first nine visible rows, first occurrence of a key only, skipping hidden rows", () =>
	{
		const rows = Array.from(
			{
				length: 12,
			},
			(_, index) => row(`r${index}`),
		);
		const root = list(rows[0]!, row("r0"), row("hidden", false), ...rows.slice(1));

		expect(assignJumpHints(collectJumpRows(root))).toStrictEqual(
			{
				r0: "1",
				r1: "2",
				r2: "3",
				r3: "4",
				r4: "5",
				r5: "6",
				r6: "7",
				r7: "8",
				r8: "9",
			},
		);
	});

	it("gives a duplicated key its first slot even when that one is hidden, like upstream", () =>
	{
		const root = list(row("a", false), row("a"), row("b"));

		expect(assignJumpHints(collectJumpRows(root))).toStrictEqual(
			{
				b: "1",
			},
		);
	});

	it("has no hints for an empty list", () =>
	{
		expect(
			{
				assigned: assignJumpHints(collectJumpRows(list())),
				missingRoot: collectJumpRows(null),
			},
		).toStrictEqual(
			{
				assigned: null,
				missingRoot: [],
			},
		);
	});

	it("stores the shown map, finds a digit's row, and only notifies a clear when something was shown", () =>
	{
		const root = list(row("a"), row("b"));
		let notified = 0;
		const unsubscribe = subscribeJumpHints(() =>
		{
			notified++;
		});

		clearJumpHints();
		const beforeShow = notified;
		showJumpHints(root);
		const found = [jumpRowKeyFor("2"), jumpRowKeyFor("3")];
		clearJumpHints();
		clearJumpHints();
		unsubscribe();

		expect(
			{
				beforeShow,
				found,
				notified,
				after: jumpRowKeyFor("1"),
			},
		).toStrictEqual(
			{
				beforeShow: 0,
				found: ["b", null],
				notified: 2,
				after: null,
			},
		);
	});
});
