// @vitest-environment jsdom

import {describe, expect, it} from "vite-plus/test";

import
{
	clearsSelectionOnPress,
	EMPTY_SELECTION,
	selectionClickKind,
	sidebarSelectionReducer,
	type SidebarSelection,
	visibleSelection,
} from "../src/lib/sidebar-selection";

const ORDER = ["a", "b", "c", "d", "e"];

function select(ids: string[], anchor: string | null): SidebarSelection
{
	return {
		ids,
		anchor,
	};
}

describe("sidebarSelectionReducer", () =>
{
	it("⌘-click adds an unselected row and makes it the anchor", () =>
	{
		expect(
			sidebarSelectionReducer(
				select(["a"], "a"),
				{
					type: "toggle",
					id: "c",
					order: ORDER,
				},
			),
		).toStrictEqual(select(["a", "c"], "c"));
	});

	it("⌘-click on a selected row removes it and keeps the anchor", () =>
	{
		expect(
			sidebarSelectionReducer(
				select(["a", "c"], "c"),
				{
					type: "toggle",
					id: "a",
					order: ORDER,
				},
			),
		).toStrictEqual(select(["c"], "c"));
	});

	it("⌘-click removing the anchor moves the anchor to the last remaining row", () =>
	{
		expect(
			sidebarSelectionReducer(
				select(["a", "c", "e"], "c"),
				{
					type: "toggle",
					id: "c",
					order: ORDER,
				},
			),
		).toStrictEqual(select(["a", "e"], "e"));
	});

	it("keeps the selection in display order whatever order rows were clicked", () =>
	{
		const first = sidebarSelectionReducer(
			EMPTY_SELECTION,
			{
				type: "toggle",
				id: "d",
				order: ORDER,
			},
		);
		expect(
			sidebarSelectionReducer(
				first,
				{
					type: "toggle",
					id: "b",
					order: ORDER,
				},
			),
		).toStrictEqual(select(["b", "d"], "b"));
	});

	it("⇧-click selects the range from the anchor, replacing the rest", () =>
	{
		expect(
			sidebarSelectionReducer(
				select(["a", "b"], "b"),
				{
					type: "extend",
					id: "d",
					order: ORDER,
					focusedId: null,
				},
			),
		).toStrictEqual(select(["b", "c", "d"], "b"));
	});

	it("⇧-click above the anchor selects upward", () =>
	{
		expect(
			sidebarSelectionReducer(
				select(["d"], "d"),
				{
					type: "extend",
					id: "b",
					order: ORDER,
					focusedId: null,
				},
			),
		).toStrictEqual(select(["b", "c", "d"], "d"));
	});

	it("⇧-click with no anchor starts from the open session", () =>
	{
		expect(
			sidebarSelectionReducer(
				EMPTY_SELECTION,
				{
					type: "extend",
					id: "c",
					order: ORDER,
					focusedId: "e",
				},
			),
		).toStrictEqual(select(["c", "d", "e"], "e"));
	});

	it("⇧-click with no anchor and no visible open session selects just the row", () =>
	{
		expect(
			sidebarSelectionReducer(
				EMPTY_SELECTION,
				{
					type: "extend",
					id: "c",
					order: ORDER,
					focusedId: "zzz",
				},
			),
		).toStrictEqual(select(["c"], "c"));
	});

	it("⇧-click from an anchor that scrolled out of view selects just the row", () =>
	{
		expect(
			sidebarSelectionReducer(
				select(["gone"], "gone"),
				{
					type: "extend",
					id: "b",
					order: ORDER,
					focusedId: null,
				},
			),
		).toStrictEqual(select(["b"], "b"));
	});

	it("add merges a group's rows into the selection in display order, anchoring on its last row", () =>
	{
		expect(
			sidebarSelectionReducer(
				select(["e", "a"], "e"),
				{
					type: "add",
					ids: ["b", "c"],
					order: ORDER,
				},
			),
		).toStrictEqual(select(["a", "b", "c", "e"], "c"));
	});

	it("add with no rows returns the same state", () =>
	{
		const state = select(["a"], "a");
		expect(
			sidebarSelectionReducer(
				state,
				{
					type: "add",
					ids: [],
					order: ORDER,
				},
			),
		).toBe(state);
	});

	it("set replaces the selection with the rows in display order, anchoring on the last", () =>
	{
		expect(
			sidebarSelectionReducer(
				select(["a"], "a"),
				{
					type: "set",
					ids: ["c", "b"],
					order: ["a", "b", "c"],
				},
			),
		).toStrictEqual(select(["b", "c"], "c"));
	});

	it("set with no rows empties the selection", () =>
	{
		expect(
			sidebarSelectionReducer(
				select(["a"], "a"),
				{
					type: "set",
					ids: [],
					order: ORDER,
				},
			),
		).toStrictEqual(EMPTY_SELECTION);
	});

	it("clear empties the selection", () =>
	{
		expect(
			sidebarSelectionReducer(
				select(["a", "b"], "a"),
				{
					type: "clear",
				},
			),
		).toStrictEqual(EMPTY_SELECTION);
	});

	it("clear on an empty selection returns the same state", () =>
	{
		expect(
			sidebarSelectionReducer(
				EMPTY_SELECTION,
				{
					type: "clear",
				},
			),
		).toBe(EMPTY_SELECTION);
	});
});

describe("visibleSelection", () =>
{
	it("drops selected rows that are no longer shown, in display order", () =>
	{
		expect(visibleSelection(select(["d", "gone", "a"], "d"), ORDER)).toStrictEqual(["a", "d"]);
	});
});

describe("selectionClickKind", () =>
{
	it.each<
		[
			string,
			{
				metaKey: boolean;
				ctrlKey: boolean;
				shiftKey: boolean;
			},
			string,
		]
	>([
		[
			"plain click",
			{
				metaKey: false,
				ctrlKey: false,
				shiftKey: false,
			},
			"plain",
		],
		[
			"⌘-click",
			{
				metaKey: true,
				ctrlKey: false,
				shiftKey: false,
			},
			"toggle",
		],
		[
			"Ctrl-click",
			{
				metaKey: false,
				ctrlKey: true,
				shiftKey: false,
			},
			"toggle",
		],
		[
			"⇧-click",
			{
				metaKey: false,
				ctrlKey: false,
				shiftKey: true,
			},
			"extend",
		],
		[
			"⌘⇧-click",
			{
				metaKey: true,
				ctrlKey: false,
				shiftKey: true,
			},
			"extend",
		],
	])("%s", (_name, modifiers, kind) =>
	{
		expect(selectionClickKind(modifiers)).toBe(kind);
	});
});

describe("clearsSelectionOnPress", () =>
{
	function inside(markup: string): Element
	{
		const host = document.createElement("div");
		host.innerHTML = markup;
		const target = host.querySelector("[data-target]");
		if (target === null) throw new Error("no target");
		return target;
	}

	function press(
		target: EventTarget | null,
		modifiers: Partial<Pick<PointerEvent, "shiftKey" | "metaKey" | "ctrlKey" | "altKey" | "button">> = {},
	)
	{
		return clearsSelectionOnPress(
			{
				shiftKey: false,
				metaKey: false,
				ctrlKey: false,
				button: 0,
				...modifiers,
				target,
			},
		);
	}

	it("clears on a plain or ⌥ primary press outside, keeps on a modifier or non-primary press or an excluded region", () =>
	{
		const main = document.createElement("main");
		expect(
			{
				plain: press(main),
				alt: press(
					main,
					{
						altKey: true,
					},
				),
				shift: press(
					main,
					{
						shiftKey: true,
					},
				),
				meta: press(
					main,
					{
						metaKey: true,
					},
				),
				ctrl: press(
					main,
					{
						ctrlKey: true,
					},
				),
				right: press(
					main,
					{
						button: 2,
					},
				),
				middle: press(
					main,
					{
						button: 1,
					},
				),
				notElement: press(null),
				row: press(inside('<div data-row-key="u1"><span data-target></span></div>')),
				list: press(inside('<div data-kind="code"><span data-target></span></div>')),
				portal: press(inside('<div data-cds-portal=""><span data-target></span></div>')),
				popper: press(inside("<div data-radix-popper-content-wrapper><span data-target></span></div>")),
				menu: press(inside('<div role="menu"><span data-target></span></div>')),
				listbox: press(inside('<div role="listbox"><span data-target></span></div>')),
				dialog: press(inside('<div role="dialog"><span data-target></span></div>')),
				alertdialog: press(inside('<div role="alertdialog"><span data-target></span></div>')),
				svgInRow: press(inside('<div data-row-key="u1"><svg><path data-target></path></svg></div>')),
			},
		).toStrictEqual(
			{
				plain: true,
				alt: true,
				shift: false,
				meta: false,
				ctrl: false,
				right: false,
				middle: false,
				notElement: true,
				row: false,
				list: false,
				portal: false,
				popper: false,
				menu: false,
				listbox: false,
				dialog: false,
				alertdialog: false,
				svgInRow: false,
			},
		);
	});
});
