import {describe, expect, it} from "vite-plus/test";

import {type LayoutNode, type PaneLayoutState, type StackNode, type TileId} from "../src/lib/pane-layout";
import
{
	applyTileDrop,
	dropIndicatorEdge,
	dropRect,
	inMultiChildColumn,
	keyboardTileMove,
	resolveTileDrop,
	stackDropFeedback,
	stackRectKey,
	touchesContainerEdge,
	type DropRect,
	type TileDropTarget,
} from "../src/lib/tile-drop";

function tile(tileId: TileId, flex = 1): LayoutNode
{
	return {
		kind: "tile",
		tileId,
		flex,
	};
}

function stack(direction: "row" | "column", children: LayoutNode[], flex = 1): StackNode
{
	return {
		kind: "stack",
		direction,
		flex,
		children,
	};
}

function state(root: StackNode): PaneLayoutState
{
	return {
		root,
		expanded: null,
		focused: "chat",
	};
}

/** `chat | column[plan, files]` at 984x806, as upstream's RUN 2 probe measured it (shifted to the tile container). */
const THREE = stack("row", [tile("chat", 2), stack("column", [tile("plan"), tile("files")])]);
const THREE_RECTS: ReadonlyMap<string, DropRect> = new Map([
	[stackRectKey([]), dropRect(0, 0, 984, 806)],
	[stackRectKey([1]), dropRect(656, 0, 328, 806)],
	["chat", dropRect(0, 0, 656, 806)],
	["plan", dropRect(656, 0, 328, 403)],
	["files", dropRect(656, 403, 328, 403)],
]);
/** The Files grip's top centre. */
const FILES_START =
{
	x: 820,
	y: 405,
};

/** `chat | plan`, as upstream's live probe measured it, dragged from the plan grip at (800,5). */
const TWO = stack("row", [tile("chat", 2), tile("plan")]);
const TWO_RECTS: ReadonlyMap<string, DropRect> = new Map([
	[stackRectKey([]), dropRect(0, 0, 984, 806)],
	["chat", dropRect(0, 0, 656, 806)],
	["plan", dropRect(656, 0, 328, 806)],
]);
const PLAN_START =
{
	x: 800,
	y: 5,
};

function targetAt(
	root: StackNode,
	tileId: TileId,
	rects: ReadonlyMap<string, DropRect>,
	x: number,
	y: number,
	start:
	{
		x: number;
		y: number;
	},
	fullHeight: ReadonlySet<TileId> = new Set(),
): TileDropTarget | "rearrange" | null
{
	const resolution = resolveTileDrop(
		root,
		tileId,
		rects,
		{
			x,
			y,
		},
		start,
		fullHeight,
	);
	return resolution.kind === "drop" ? resolution.target : resolution.kind === "rearrange" ? "rearrange" : null;
}

describe("resolveTileDrop (upstream cf53e1812 T + k)", () =>
{
	it.each([
		[
			"a root insert band between the chat and the column",
			512,
			400,
			{
				kind: "insert",
				stackPath: [],
				index: 1,
			},
		],
		[
			"the sibling's 1/3 strip splits the source's 2-child column",
			692,
			250,
			{
				kind: "split",
				stackPath: [1],
				direction: "row",
				index: 0,
			},
		],
		[
			"the root's 7px left band",
			2,
			400,
			{
				kind: "split",
				stackPath: [],
				direction: "row",
				index: 0,
			},
		],
		[
			"the chat's 24px top strip wraps it (the root band stops at 7px)",
			212,
			10,
			{
				kind: "wrap",
				tileId: "chat",
				direction: "column",
				index: 0,
			},
		],
		["nothing within 16px of the start", 820 + 15, 405, null],
	] satisfies Array<[string, number, number, TileDropTarget | null]>)("%s", (_name, x, y, expected) =>
	{
		expect(targetAt(THREE, "files", THREE_RECTS, x, y, FILES_START)).toStrictEqual(expected);
	});

	it.each([
		["the chat's top strip is trimmed off the start pointer's band", 600, 12, null],
		[
			"the trimmed strip below it splits the root column",
			600,
			30,
			{
				kind: "split",
				stackPath: [],
				direction: "column",
				index: 0,
			},
		],
		[
			"the chat's bottom third",
			600,
			700,
			{
				kind: "split",
				stackPath: [],
				direction: "column",
				index: 1,
			},
		],
		["past the chat's midpoint, a live rearrange", 312, 400, "rearrange"],
		["before the chat's midpoint, no target", 600, 400, null],
	] satisfies Array<[string, number, number, TileDropTarget | "rearrange" | null]>)("%s", (_name, x, y, expected) =>
	{
		expect(targetAt(TWO, "plan", TWO_RECTS, x, y, PLAN_START)).toStrictEqual(expected);
	});

	it("drops every target that would put an opted-in fullHeight tile into a multi-child column", () =>
	{
		const chat: ReadonlySet<TileId> = new Set(["chat"]);
		expect([
			targetAt(TWO, "plan", TWO_RECTS, 600, 30, PLAN_START, chat),
			targetAt(TWO, "plan", TWO_RECTS, 600, 700, PLAN_START, chat),
		]).toStrictEqual([null, null]);
	});

	it("reorders the source stack live, past a sibling's midpoint", () =>
	{
		expect(
			resolveTileDrop(
				TWO,
				"plan",
				TWO_RECTS,
				{
					x: 312,
					y: 400,
				},
				PLAN_START,
			),
		).toStrictEqual(
			{
				kind: "rearrange",
				root: stack("row", [tile("plan"), tile("chat", 2)]),
			},
		);
	});
});

describe("applyTileDrop (upstream cf53e1812 A)", () =>
{
	it.each([
		[
			"insert into another stack keeps the tile's flex and collapses the emptied column",
			{
				kind: "insert",
				stackPath: [],
				index: 1,
			},
			stack("row", [tile("chat", 2), tile("files"), tile("plan")]),
		],
		[
			"a perpendicular split wraps the whole stack",
			{
				kind: "split",
				stackPath: [1],
				direction: "row",
				index: 0,
			},
			stack("row", [tile("chat", 2), tile("files"), tile("plan")]),
		],
		[
			"a same-direction split inserts at the index",
			{
				kind: "split",
				stackPath: [],
				direction: "row",
				index: 0,
			},
			stack("row", [tile("files"), tile("chat", 2), tile("plan")]),
		],
		[
			"a perpendicular split of the root makes a new root",
			{
				kind: "split",
				stackPath: [],
				direction: "column",
				index: 1,
			},
			stack("column", [stack("row", [tile("chat", 2), tile("plan")]), tile("files")]),
		],
		[
			"a wrap replaces the tile with a stack around both",
			{
				kind: "wrap",
				tileId: "chat",
				direction: "column",
				index: 0,
			},
			stack("row", [stack("column", [tile("files"), tile("chat")], 2), tile("plan")]),
		],
	] satisfies Array<[string, TileDropTarget, StackNode]>)("%s", (_name, target, root) =>
	{
		expect(applyTileDrop(state(THREE), "files", target)).toStrictEqual(
			{
				root,
				expanded: null,
				focused: "files",
			},
		);
	});
});

describe("inMultiChildColumn (upstream cf53e1812 m)", () =>
{
	it.each([
		["row[chat, plan]", stack("row", [tile("chat"), tile("plan")]), "chat", false],
		["column[plan, chat]", stack("column", [tile("plan"), tile("chat")]), "chat", true],
		[
			"row[column[plan, chat], files]",
			stack("row", [stack("column", [tile("plan"), tile("chat")]), tile("files")]),
			"chat",
			true,
		],
		["a 1-child column", stack("column", [stack("row", [tile("chat"), tile("plan")])]), "chat", false],
		["row[chat, column[plan, files]] for chat", THREE, "chat", false],
		["row[chat, column[plan, files]] for files", THREE, "files", true],
		["a missing tile", THREE, "terminal", false],
	] satisfies Array<[string, StackNode, TileId, boolean]>)("%s", (_name, root, tileId, expected) =>
	{
		expect(inMultiChildColumn(root, tileId)).toStrictEqual(expected);
	});
});

describe("keyboardTileMove (upstream ca67f2c9d getTileDragProps onKeyDown)", () =>
{
	it.each([
		[
			"ArrowLeft along a row inserts at once",
			"ArrowLeft",
			{
				kind: "insert",
				target:
				{
					kind: "insert",
					stackPath: [],
					index: 0,
				},
				position: 1,
				total: 2,
			},
		],
		["ArrowRight at the row's end does nothing", "ArrowRight", null],
		[
			"ArrowDown previews a split of the parent row",
			"ArrowDown",
			{
				kind: "preview",
				side: "down",
				target:
				{
					kind: "split",
					stackPath: [],
					direction: "column",
					index: 1,
				},
			},
		],
		[
			"ArrowUp previews the parent row's top edge",
			"ArrowUp",
			{
				kind: "preview",
				side: "up",
				target:
				{
					kind: "split",
					stackPath: [],
					direction: "column",
					index: 0,
				},
			},
		],
		[
			"Home inserts first",
			"Home",
			{
				kind: "insert",
				target:
				{
					kind: "insert",
					stackPath: [],
					index: 0,
				},
				position: 1,
				total: 2,
			},
		],
		["another key is not a move", "a", null],
	] satisfies Array<[string, string, ReturnType<typeof keyboardTileMove>]>)("%s", (_name, key, expected) =>
	{
		expect(keyboardTileMove(TWO, "plan", key)).toStrictEqual(expected);
	});

	it("previews a row split for a tile in a column", () =>
	{
		expect(keyboardTileMove(THREE, "files", "ArrowLeft")).toStrictEqual(
			{
				kind: "preview",
				side: "left",
				target:
				{
					kind: "split",
					stackPath: [1],
					direction: "row",
					index: 0,
				},
			},
		);
	});
});

describe("drop feedback placement (upstream ca67f2c9d stack ct, Ke and Z)", () =>
{
	it.each([
		[
			"an insert between children lights the divider",
			{
				kind: "insert",
				stackPath: [],
				index: 1,
			},
			{
				dividerIndex: 0,
				edge: null,
			},
		],
		[
			"an insert at 0 is the main-start edge",
			{
				kind: "insert",
				stackPath: [],
				index: 0,
			},
			{
				dividerIndex: null,
				edge: "left",
			},
		],
		[
			"a same-direction split at the end is the main-end edge",
			{
				kind: "split",
				stackPath: [],
				direction: "row",
				index: 2,
			},
			{
				dividerIndex: null,
				edge: "right",
			},
		],
		[
			"a perpendicular split at 1 is the cross-end edge",
			{
				kind: "split",
				stackPath: [],
				direction: "column",
				index: 1,
			},
			{
				dividerIndex: null,
				edge: "bottom",
			},
		],
		[
			"another stack's target leaves this one alone",
			{
				kind: "split",
				stackPath: [1],
				direction: "row",
				index: 0,
			},
			{
				dividerIndex: null,
				edge: null,
			},
		],
		[
			"a wrap is drawn on its tile, not a stack",
			{
				kind: "wrap",
				tileId: "chat",
				direction: "column",
				index: 0,
			},
			{
				dividerIndex: null,
				edge: null,
			},
		],
	] satisfies Array<[string, TileDropTarget, ReturnType<typeof stackDropFeedback>]>)(
		"%s",
		(_name, target, expected) =>
		{
			expect(stackDropFeedback(THREE, [], target)).toStrictEqual(expected);
		},
	);

	it("maps positions to edges, swapping left and right in RTL", () =>
	{
		expect([
			dropIndicatorEdge("main-start", "row"),
			dropIndicatorEdge("main-end", "row"),
			dropIndicatorEdge("cross-start", "row"),
			dropIndicatorEdge("main-start", "column"),
			dropIndicatorEdge("cross-end", "column"),
			dropIndicatorEdge("main-start", "row", true),
		]).toStrictEqual(["left", "right", "top", "top", "right", "right"]);
	});

	it("knows which container edges a node touches", () =>
	{
		expect([
			touchesContainerEdge(THREE, []),
			touchesContainerEdge(THREE, [1]),
			touchesContainerEdge(THREE, [1, 1]),
		]).toStrictEqual([
			{
				left: true,
				right: true,
				top: true,
				bottom: true,
			},
			{
				left: false,
				right: true,
				top: true,
				bottom: true,
			},
			{
				left: false,
				right: true,
				top: false,
				bottom: true,
			},
		]);
	});
});
