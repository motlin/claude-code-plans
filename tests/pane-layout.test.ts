import {describe, expect, it} from "vite-plus/test";
import
{
	PANE_FLEX_STORAGE_KEY,
	PANE_LAYOUT_STORAGE_KEY,
	type ClosedPaneSlot,
	type LayoutNode,
	type PaneKind,
	type PaneLayoutState,
	type StackNode,
	type TileId,
	chatGutters,
	chatShellPadding,
	closePane,
	collapsePane,
	defaultPaneLayout,
	expandPane,
	focusNeighbour,
	focusPane,
	hiddenWhileExpanded,
	isNodeHidden,
	TILES_KEPT_WHILE_EXPANDED,
	loadChangesScope,
	loadPaneLayout,
	loadSubagentPaneAgent,
	minTileSize,
	movePaneToEdge,
	paneAtEdge,
	leftEdgeTiles,
	rowEndOnlyTileIds,
	resolveFlexes,
	resolveTileLayout,
	tileFloor,
	fitOpenedLayout,
	fitPhoneLayout,
	openPane,
	overlayTile,
	settleOverlay,
	syncOverlayPaneFlex,
	loadLastPaneFlex,
	rememberPaneFlex,
	resizeDivider,
	saveLastPaneFlex,
	saveChangesScope,
	savePaneLayout,
	saveSubagentPaneAgent,
	togglePane,
	topEdgeTiles,
	updatePhoneView,
	wideRowTopPadding,
} from "../src/lib/pane-layout";

function tile(tileId: TileId, flex: number): LayoutNode
{
	return {
		kind: "tile",
		tileId,
		flex,
	};
}

function stack(direction: "row" | "column", flex: number, children: LayoutNode[]): StackNode
{
	return {
		kind: "stack",
		direction,
		flex,
		children,
	};
}

function layout(children: LayoutNode[], focused: TileId, expanded: PaneKind | null = null): PaneLayoutState
{
	return {
		root: stack("row", 1, children),
		expanded,
		focused,
	};
}

function slotted(state: PaneLayoutState, kind: PaneKind, slot: ClosedPaneSlot): PaneLayoutState
{
	return {
		...state,
		closedSlots:
		{
			[kind]: slot,
		},
	};
}

const CHANGES_UNDER_BACKGROUND_TASKS: ClosedPaneSlot =
{
	anchorIds: ["background-tasks"],
	otherSideIds: [],
	direction: "column",
	side: 1,
	ratio: 1,
};

function openAll(...kinds: PaneKind[]): PaneLayoutState
{
	return kinds.reduce((state, kind) => openPane(state, kind), defaultPaneLayout());
}

const ONE_PANE = layout([tile("chat", 2), tile("background-tasks", 1)], "background-tasks");
const TWO_PANES = layout(
	[tile("chat", 2), stack("column", 1, [tile("background-tasks", 1), tile("changes", 1)])],
	"changes",
);
const THREE_PANES = layout(
	[tile("chat", 2), stack("column", 1, [tile("background-tasks", 1), tile("changes", 1)]), tile("files", 1)],
	"files",
);

class ThrowingStorage implements Storage
{
	readonly length = 0;
	clear(): void
	{
		throw new Error("denied");
	}
	getItem(): string | null
	{
		throw new Error("denied");
	}
	key(): string | null
	{
		throw new Error("denied");
	}
	removeItem(): void
	{
		throw new Error("denied");
	}
	setItem(): void
	{
		throw new Error("denied");
	}
}

class MemoryStorage implements Storage
{
	readonly values = new Map<string, string>();
	get length(): number
	{
		return this.values.size;
	}
	clear(): void
	{
		this.values.clear();
	}
	getItem(key: string): string | null
	{
		return this.values.get(key) ?? null;
	}
	key(index: number): string | null
	{
		return [...this.values.keys()][index] ?? null;
	}
	removeItem(key: string): void
	{
		this.values.delete(key);
	}
	setItem(key: string, value: string): void
	{
		this.values.set(key, value);
	}
}

describe("defaultPaneLayout", () =>
{
	it("is a single chat tile in a row", () =>
	{
		expect(defaultPaneLayout()).toEqual(
			{
				root:
				{
					kind: "stack",
					direction: "row",
					flex: 1,
					children: [tile("chat", 1)],
				},
				expanded: null,
				focused: "chat",
			},
		);
	});
});

describe("openPane follows upstream placement", () =>
{
	it.each([
		[
			"1st narrow pane splits the row chat 2 : pane 1",
			["background-tasks"],
			layout([tile("chat", 2), tile("background-tasks", 1)], "background-tasks"),
		],
		[
			"2nd pane stacks under the side column",
			["background-tasks", "plan"],
			layout([tile("chat", 2), stack("column", 1, [tile("background-tasks", 1), tile("plan", 1)])], "plan"),
		],
		[
			"3rd pane opens a new column",
			["background-tasks", "plan", "files"],
			layout(
				[tile("chat", 2), stack("column", 1, [tile("background-tasks", 1), tile("plan", 1)]), tile("files", 1)],
				"files",
			),
		],
		[
			"4th pane stacks under the newest column",
			["background-tasks", "plan", "files", "links"],
			layout(
				[
					tile("chat", 2),
					stack("column", 1, [tile("background-tasks", 1), tile("plan", 1)]),
					stack("column", 1, [tile("files", 1), tile("links", 1)]),
				],
				"links",
			),
		],
		[
			"Changes as the first side pane splits the row 2:3, like upstream's other panes",
			["changes"],
			layout([tile("chat", 2), tile("changes", 3)], "changes"),
		],
	] satisfies Array<[string, PaneKind[], PaneLayoutState]>)("%s", (_name, kinds, expected) =>
	{
		expect(openAll(...kinds)).toEqual(expected);
	});

	it.each([
		["terminal", 1],
		["background-tasks", 1],
		["plan", 1],
		["subagents", 1],
		["session-details", 1],
		["side-chat", 1],
		["links", 1],
		["files", 3],
		["changes", 3],
		["artifacts", 3],
	] satisfies Array<[PaneKind, number]>)(
		"opens %s alone at chat 2 : pane %d (upstream's wide set gets 3)",
		(kind, flex) =>
		{
			expect(openPane(defaultPaneLayout(), kind)).toEqual(layout([tile("chat", 2), tile(kind, flex)], kind));
		},
	);

	it("uses the remembered per-kind flex for the first pane (upstream lastPaneFlexByKind)", () =>
	{
		expect([
			openPane(
				defaultPaneLayout(),
				"files",
				{
					files: 2,
				},
			),
			openPane(
				ONE_PANE,
				"files",
				{
					files: 2,
				},
			),
		]).toEqual([
			layout([tile("chat", 2), tile("files", 2)], "files"),
			layout([tile("chat", 2), stack("column", 1, [tile("background-tasks", 1), tile("files", 1)])], "files"),
		]);
	});

	it("appends a new column when chat is the root row's last child, as upstream's F does", () =>
	{
		expect([
			openPane(layout([tile("files", 3), tile("chat", 2)], "chat"), "plan"),
			openPane(layout([tile("chat", 2), tile("files", 3)], "chat"), "plan"),
		]).toEqual([
			layout([tile("files", 3), tile("chat", 2), tile("plan", 1)], "plan"),
			layout([tile("chat", 2), stack("column", 3, [tile("files", 1), tile("plan", 1)])], "plan"),
		]);
	});

	it("opens Files alone at chat 2 : files 3", () =>
	{
		expect(openPane(defaultPaneLayout(), "files")).toEqual(layout([tile("chat", 2), tile("files", 3)], "files"));
	});

	it("stacks Changes under the last pane like any other pane, as upstream does at desktop width", () =>
	{
		const files = openPane(defaultPaneLayout(), "files");
		const changes = openPane(defaultPaneLayout(), "changes");
		expect([
			openPane(files, "changes"),
			openPane(changes, "files"),
			openAll("files", "background-tasks", "changes"),
			openAll("changes", "plan", "files"),
		]).toEqual([
			layout([tile("chat", 2), stack("column", 3, [tile("files", 1), tile("changes", 1)])], "changes"),
			layout([tile("chat", 2), stack("column", 3, [tile("changes", 1), tile("files", 1)])], "files"),
			layout(
				[
					tile("chat", 2),
					stack("column", 3, [tile("files", 1), tile("background-tasks", 1)]),
					tile("changes", 1),
				],
				"changes",
			),
			layout(
				[tile("chat", 2), stack("column", 3, [tile("changes", 1), tile("plan", 1)]), tile("files", 1)],
				"files",
			),
		]);
	});

	it("focuses an already-open pane without changing the tree", () =>
	{
		expect(openPane(THREE_PANES, "background-tasks")).toEqual(
			{
				...THREE_PANES,
				focused: "background-tasks",
			},
		);
	});

	it("collapses a different pane's expansion when re-opening an open pane", () =>
	{
		expect(openPane(expandPane(TWO_PANES, "background-tasks"), "changes")).toEqual(
			{
				...TWO_PANES,
				expanded: null,
				focused: "changes",
			},
		);
		expect(openPane(expandPane(TWO_PANES, "changes"), "changes")).toEqual(expandPane(TWO_PANES, "changes"));
	});

	it("leaves expanded mode when another pane opens", () =>
	{
		const expanded = expandPane(ONE_PANE, "background-tasks");
		expect(openPane(expanded, "plan")).toEqual(
			layout([tile("chat", 2), stack("column", 1, [tile("background-tasks", 1), tile("plan", 1)])], "plan"),
		);
	});
});

describe("focusNeighbour (upstream ca67f2c9d Oe)", () =>
{
	// [files | [changes / terminal]] | chat
	const NESTED = stack("row", 1, [
		stack("row", 2, [tile("files", 1), stack("column", 1, [tile("changes", 1), tile("terminal", 1)])]),
		tile("chat", 1),
	]);

	it("walks up from the tile, trying earlier siblings nearest first, then later ones, and enters a stack by its first leaf", () =>
	{
		const all = () => true;
		expect(
			{
				files: focusNeighbour(NESTED, "files", all),
				terminal: focusNeighbour(NESTED, "terminal", all),
				terminalSkippingChanges: focusNeighbour(NESTED, "terminal", (id) => id !== "changes"),
				chat: focusNeighbour(NESTED, "chat", all),
				onlyChat: focusNeighbour(NESTED, "files", (id) => id === "chat"),
				none: focusNeighbour(NESTED, "files", () => false),
				missing: focusNeighbour(NESTED, "plan", all),
			},
		).toStrictEqual(
			{
				files: "changes",
				terminal: "changes",
				terminalSkippingChanges: "files",
				chat: "files",
				onlyChat: "chat",
				none: null,
				missing: null,
			},
		);
	});
});

describe("closePane", () =>
{
	it.each([
		[
			"closing the middle pane collapses its column",
			THREE_PANES,
			"changes",
			slotted(
				layout([tile("chat", 2), tile("background-tasks", 1), tile("files", 1)], "files"),
				"changes",
				CHANGES_UNDER_BACKGROUND_TASKS,
			),
		],
		[
			"closing the focused pane focuses its nearest layout neighbour (upstream Oe), a stack by its first leaf",
			THREE_PANES,
			"files",
			slotted(
				layout(
					[tile("chat", 2), stack("column", 1, [tile("background-tasks", 1), tile("changes", 1)])],
					"background-tasks",
				),
				"files",
				{
					anchorIds: ["background-tasks", "changes"],
					otherSideIds: [],
					direction: "row",
					side: 1,
					ratio: 1 / 3,
				},
			),
		],
		[
			"closing the focused pane focuses its previous sibling first",
			TWO_PANES,
			"changes",
			slotted(
				layout([tile("chat", 2), tile("background-tasks", 1)], "background-tasks"),
				"changes",
				{
					anchorIds: ["background-tasks"],
					otherSideIds: [],
					direction: "column",
					side: 1,
					ratio: 1,
				},
			),
		],
		[
			"closing a stacked pane hands the column's flex to its sibling",
			TWO_PANES,
			"background-tasks",
			slotted(
				layout([tile("chat", 2), tile("changes", 1)], "changes"),
				"background-tasks",
				{
					anchorIds: ["changes"],
					otherSideIds: [],
					direction: "column",
					side: 0,
					ratio: 1,
				},
			),
		],
		[
			"closing the last pane restores the default and records no slot (upstream Xc)",
			ONE_PANE,
			"background-tasks",
			defaultPaneLayout(),
		],
	] satisfies Array<[string, PaneLayoutState, PaneKind, PaneLayoutState]>)("%s", (_name, state, kind, expected) =>
	{
		expect(closePane(state, kind)).toEqual(expected);
	});

	it("clears expanded mode when the expanded pane closes", () =>
	{
		expect(closePane(expandPane(TWO_PANES, "changes"), "changes")).toEqual(
			slotted(
				layout([tile("chat", 2), tile("background-tasks", 1)], "background-tasks"),
				"changes",
				CHANGES_UNDER_BACKGROUND_TASKS,
			),
		);
	});

	it("returns the same state when the pane is not open", () =>
	{
		expect(closePane(ONE_PANE, "files")).toBe(ONE_PANE);
	});

	it("drops the closing lone pane's existing slot but keeps other kinds' slots", () =>
	{
		const filesSlot: ClosedPaneSlot =
		{
			anchorIds: ["changes"],
			otherSideIds: [],
			direction: "column",
			side: 0,
			ratio: 1,
		};
		const state: PaneLayoutState =
		{
			...layout([tile("chat", 2), tile("changes", 3)], "changes"),
			closedSlots:
			{
				changes: CHANGES_UNDER_BACKGROUND_TASKS,
				files: filesSlot,
			},
		};
		expect(closePane(state, "changes")).toEqual(
			{
				...defaultPaneLayout(),
				closedSlots:
				{
					files: filesSlot,
				},
			},
		);
	});

	it("reopens the lone pane at the default split, as upstream's r[chat:2,diff:3]", () =>
	{
		const reopened = openPane(closePane(openPane(defaultPaneLayout(), "changes"), "changes"), "changes");
		expect(reopened).toEqual(layout([tile("chat", 2), tile("changes", 3)], "changes"));
	});

	it("leaves slots alone on an unprompted close (upstream closeSidePane {unprompted})", () =>
	{
		const filesSlot: ClosedPaneSlot =
		{
			anchorIds: ["plan"],
			otherSideIds: [],
			direction: "column",
			side: 0,
			ratio: 1,
		};
		expect([
			closePane(
				TWO_PANES,
				"changes",
				{
					unprompted: true,
				},
			),
			closePane(
				{
					...TWO_PANES,
					closedSlots:
					{
						files: filesSlot,
					},
				},
				"changes",
				{
					unprompted: true,
				},
			),
		]).toEqual([
			layout([tile("chat", 2), tile("background-tasks", 1)], "background-tasks"),
			{
				...layout([tile("chat", 2), tile("background-tasks", 1)], "background-tasks"),
				closedSlots:
				{
					files: filesSlot,
				},
			},
		]);
	});
});

describe("closed pane slots", () =>
{
	const filesOverChanges = openAll("files", "changes");

	it("remembers where a closed pane sat, as upstream's closedPaneSlotsBySession does", () =>
	{
		expect(closePane(filesOverChanges, "files")).toEqual(
			{
				...layout([tile("chat", 2), tile("changes", 3)], "changes"),
				closedSlots:
				{
					files:
					{
						anchorIds: ["changes"],
						otherSideIds: [],
						direction: "column",
						side: 0,
						ratio: 1,
					},
				},
			},
		);
	});

	it("reopens Files above Changes when it was closed from there, and forgets the slot", () =>
	{
		expect(openPane(closePane(filesOverChanges, "files"), "files")).toEqual(
			layout([tile("chat", 2), stack("column", 3, [tile("files", 1), tile("changes", 1)])], "files"),
		);
	});

	it("reopens a pane between its old neighbours in a row", () =>
	{
		const threeColumns = layout([tile("chat", 2), tile("files", 1), tile("plan", 1)], "plan");
		expect(openPane(closePane(threeColumns, "files"), "files")).toEqual(
			layout([tile("chat", 2), tile("files", 1), tile("plan", 1)], "files"),
		);
	});

	it("falls back to stacking when the slot's anchor is gone", () =>
	{
		const state = ["files", "changes"].reduce<PaneLayoutState>(
			(acc, kind) => closePane(acc, kind as PaneKind),
			openAll("files", "changes", "plan"),
		);
		expect(openPane(state, "files")).toEqual(
			{
				...layout([tile("chat", 2), stack("column", 1, [tile("plan", 1), tile("files", 1)])], "files"),
				closedSlots:
				{
					changes:
					{
						anchorIds: ["chat"],
						otherSideIds: ["plan"],
						direction: "row",
						side: 1,
						ratio: 1,
					},
				},
			},
		);
	});

	it("persists the slots with the layout", () =>
	{
		const storage = new MemoryStorage();
		const closed = closePane(filesOverChanges, "files");
		savePaneLayout("s", closed, storage);
		expect(loadPaneLayout("s", storage)).toEqual(closed);
	});
});

describe("rememberPaneFlex (upstream ps)", () =>
{
	const resized = layout([tile("chat", 1), tile("files", 1)], "files");

	it("stores 2 * flex / chat flex for a resized root-row tile beside chat", () =>
	{
		expect(
			rememberPaneFlex(
				resized.root,
				["chat", "files"],
				{
					plan: 0.5,
				},
			),
		).toEqual(
			{
				plan: 0.5,
				files: 2,
			},
		);
	});

	it("ignores a tile nested in a column and returns the same map when nothing changed", () =>
	{
		const lastFlex = {};
		expect(rememberPaneFlex(TWO_PANES.root, ["background-tasks", "changes"], lastFlex)).toBe(lastFlex);
	});

	it("ignores a root row without chat", () =>
	{
		const lastFlex = {};
		const noChat: StackNode = stack("row", 1, [
			stack("column", 1, [tile("chat", 1), tile("files", 1)]),
			tile("plan", 1),
		]);
		expect(rememberPaneFlex(noChat, ["plan"], lastFlex)).toBe(lastFlex);
	});

	it("round-trips through storage and falls back to {} for malformed or missing data", () =>
	{
		const storage = new MemoryStorage();
		saveLastPaneFlex(
			{
				files: 2,
				plan: 0.75,
			},
			storage,
		);
		const roundTrip = loadLastPaneFlex(storage);
		const raw: unknown = JSON.parse(storage.getItem(PANE_FLEX_STORAGE_KEY) ?? "null");
		storage.setItem(PANE_FLEX_STORAGE_KEY, "{not json");
		const corrupt = loadLastPaneFlex(storage);
		storage.setItem(
			PANE_FLEX_STORAGE_KEY,
			JSON.stringify(
				{
					files: -1,
				},
			),
		);
		const negative = loadLastPaneFlex(storage);
		expect(
			{
				raw,
				roundTrip,
				corrupt,
				negative,
				throwing: loadLastPaneFlex(new ThrowingStorage()),
				missing: loadLastPaneFlex(null),
			},
		).toEqual(
			{
				raw:
				{
					files: 2,
					plan: 0.75,
				},
				roundTrip:
				{
					files: 2,
					plan: 0.75,
				},
				corrupt: {},
				negative: {},
				throwing: {},
				missing: {},
			},
		);
		expect(() =>
		{
			saveLastPaneFlex(
				{
					files: 2,
				},
				new ThrowingStorage(),
			);
		}).not.toThrow();
	});
});

describe("expand / collapse / focus", () =>
{
	it("expands an open pane as an overlay and focuses it", () =>
	{
		expect(expandPane(TWO_PANES, "background-tasks")).toEqual(
			{
				...TWO_PANES,
				expanded: "background-tasks",
				focused: "background-tasks",
			},
		);
	});

	it("collapse restores the layout", () =>
	{
		expect(collapsePane(expandPane(TWO_PANES, "background-tasks"))).toEqual(
			{
				...TWO_PANES,
				focused: "background-tasks",
			},
		);
	});

	it("ignores expanding a pane that is not open", () =>
	{
		expect(expandPane(TWO_PANES, "files")).toBe(TWO_PANES);
	});

	it("focuses open tiles only", () =>
	{
		expect(focusPane(TWO_PANES, "chat")).toEqual(
			{
				...TWO_PANES,
				focused: "chat",
			},
		);
		expect(focusPane(TWO_PANES, "files")).toBe(TWO_PANES);
	});
});

describe("hidden tiles while a pane is expanded (upstream cc43287c9 q9, cf53e1812 z)", () =>
{
	const columnStack = stack("column", 1, [tile("files", 1), tile("changes", 1)]);
	const root = stack("row", 1, [tile("chat", 2), columnStack, tile("plan", 1)]);

	it("keeps chat, files, terminal and changes mounted while another tile is solo", () =>
	{
		expect([...TILES_KEPT_WHILE_EXPANDED].toSorted()).toStrictEqual(["changes", "chat", "files", "terminal"]);
	});

	it("hides the kept tiles other than the expanded one and drops the rest", () =>
	{
		expect(hiddenWhileExpanded(root, "changes")).toStrictEqual(new Set(["chat", "files"]));
		expect(hiddenWhileExpanded(root, null)).toStrictEqual(new Set());
	});

	it("counts a stack as hidden when every child is hidden or unmounted", () =>
	{
		const mounted = (id: TileId) => id !== "plan";
		expect(isNodeHidden(columnStack, new Set(["files", "changes"]), mounted)).toBe(true);
		expect(isNodeHidden(columnStack, new Set(["files"]), mounted)).toBe(false);
		expect(isNodeHidden(stack("column", 1, [tile("plan", 1)]), new Set(), mounted)).toBe(true);
	});
});

describe("minTileSize", () =>
{
	it.each([
		["chat", tile("chat", 1), "row", 320],
		["a pane", tile("files", 1), "row", 280],
		["a column across its axis", stack("column", 1, [tile("files", 1), tile("plan", 1)]), "row", 280],
		[
			"a column along its axis (sum plus gap)",
			stack("column", 1, [tile("files", 1), tile("plan", 1)]),
			"column",
			572,
		],
	] satisfies Array<[string, LayoutNode, "row" | "column", number]>)("%s", (_name, node, axis, expected) =>
	{
		expect(minTileSize(node, axis)).toBe(expected);
	});
});

describe("tileFloor (upstream Se, overflowMinReachable)", () =>
{
	it.each([
		["chat along a row (reachable)", tile("chat", 1), "row", 100],
		["a pane along a row", tile("files", 1), "row", 280],
		["chat along a column", tile("chat", 1), "column", 100],
		["a pane along a column", tile("files", 1), "column", 100],
		["a row along a row (sum plus 1px gaps)", stack("row", 1, [tile("chat", 1), tile("plan", 1)]), "row", 381],
		["a column along a row (max with 280)", stack("column", 1, [tile("chat", 1), tile("plan", 1)]), "row", 280],
		["a column along a column", stack("column", 1, [tile("files", 1), tile("plan", 1)]), "column", 201],
		["a row along a column (max with 100)", stack("row", 1, [tile("chat", 1), tile("plan", 1)]), "column", 100],
	] satisfies Array<[string, LayoutNode, "row" | "column", number]>)("%s", (_name, node, axis, expected) =>
	{
		expect(tileFloor(node, axis)).toBe(expected);
	});
});

describe("resolveFlexes (upstream xe)", () =>
{
	it.each([
		["floors the pane and gives the chat the rest", [2, 1], [100, 280], 699, [1.198856, 0.801144]],
		["falls back to mins-proportional when mins exhaust the space", [2, 1], [100, 280], 379, [0.526316, 1.473684]],
		["renormalises an unfloored split to the child count", [2, 1], [100, 280], 983, [1.333333, 0.666667]],
		["shares an unfloored 2:3 split proportionally", [2, 3], [100, 280], 699, [0.8, 1.2]],
		["pins the pane at 280 and gives the chat the remaining 519", [2, 1], [100, 280], 799, [1.299124, 0.700876]],
		["copies the flexes with no space", [2, 1], [100, 280], 0, [2, 1]],
		["copies an empty stack", [], [], 500, []],
	] satisfies Array<[string, number[], number[], number, number[]]>)("%s", (_name, flexes, mins, total, expected) =>
	{
		expect(resolveFlexes(flexes, mins, total).map((flex) => Math.round(flex * 1e6) / 1e6)).toStrictEqual(expected);
	});
});

describe("fitOpenedLayout (upstream withRoomForChat)", () =>
{
	const filesBeside = (chatFlex: number, filesFlex: number): StackNode =>
		stack("row", 1, [tile("chat", chatFlex), tile("files", filesFlex)]);
	const threeColumns = (chatFlex: number, columnFlex: number, planFlex: number): StackNode =>
		stack("row", 1, [
			tile("chat", chatFlex),
			stack("column", columnFlex, [tile("changes", 1), tile("files", 1)]),
			tile("plan", planFlex),
		]);
	const nestedChatRow = (filesFlex: number, columnFlex: number, chatFlex: number, planFlex: number): StackNode =>
		stack("row", 1, [
			tile("files", filesFlex),
			stack("column", columnFlex, [
				stack("row", 1, [tile("chat", chatFlex), tile("plan", planFlex)]),
				tile("background-tasks", 1),
			]),
		]);
	const tasksBeside = stack("row", 1, [tile("chat", 2), tile("background-tasks", 1)]);

	it.each([
		["the chat already reaches 320 at 1272", filesBeside(2, 3), 1272],
		["the chat already reaches 320 at 984", filesBeside(2, 3), 984],
		["the chat already reaches 320 at 801", filesBeside(2, 3), 801],
		["one spare pixel cannot beat the chat's share at 382", filesBeside(2, 3), 382],
		["a narrow pane is never grown at 800", tasksBeside, 800],
		["a narrow pane is never grown at 1000", tasksBeside, 1000],
		["the root is unmeasured", filesBeside(2, 3), 0],
		["the root is a column", stack("column", 1, [tile("chat", 1), tile("files", 1)]), 500],
	] satisfies Array<[string, StackNode, number]>)("returns the same root when %s", (_name, root, width) =>
	{
		expect(fitOpenedLayout(root, width, false)).toBe(root);
	});

	it.each([
		["grows the chat to 320 at 790", filesBeside(2, 3), 790, filesBeside(0.811153, 1.188847)],
		["grows the chat to 320 at 700", filesBeside(2, 3), 700, filesBeside(0.915594, 1.084406)],
		["grows the chat by the spare 219 at 600", filesBeside(2, 3), 600, filesBeside(1.065109, 0.934891)],
		["keeps the pane at 280 at 500", filesBeside(2, 3), 500, filesBeside(0.877756, 1.122244)],
		["fits three columns at 984", threeColumns(2, 3, 1), 984, threeColumns(0.977597, 1.167006, 0.855397)],
		["fits three columns at 900", threeColumns(2, 3, 1), 900, threeColumns(1.069042, 0.995546, 0.935412)],
		[
			"fits a chat right of the pane by index",
			stack("row", 1, [tile("files", 3), tile("chat", 2)]),
			700,
			stack("row", 1, [tile("files", 1.084406), tile("chat", 0.915594)]),
		],
		[
			"targets 320 for a column holding the chat",
			stack("row", 1, [tile("files", 3), stack("column", 2, [tile("chat", 1), tile("plan", 1)])]),
			700,
			stack("row", 1, [tile("files", 1.084406), stack("column", 0.915594, [tile("chat", 1), tile("plan", 1)])]),
		],
		[
			"recurses into a nested chat row",
			nestedChatRow(3, 2, 1, 1),
			900,
			nestedChatRow(0.662959, 1.337041, 1.066667, 0.933333),
		],
	] satisfies Array<[string, StackNode, number, StackNode]>)("%s", (_name, root, width, expected) =>
	{
		expect(fitOpenedLayout(root, width, false)).toEqual(expected);
	});

	it("fits only the root row when the open restored a closed slot (rootRowOnly)", () =>
	{
		expect(fitOpenedLayout(nestedChatRow(3, 2, 1, 1), 900, true)).toEqual(nestedChatRow(0.662959, 1.337041, 1, 1));
	});
});

describe("openPane fits user-initiated opens (upstream Ls → fitOpenedLayout)", () =>
{
	function openFitted(widthPx: number, ...kinds: PaneKind[]): PaneLayoutState[]
	{
		const states: PaneLayoutState[] = [];
		kinds.reduce((state, kind) =>
		{
			const next = openPane(
				state,
				kind,
				{},
				{
					widthPx,
				},
			);
			states.push(next);
			return next;
		}, defaultPaneLayout());
		return states;
	}
	const fittedColumns = (chatFlex: number, columnFlex: number, planFlex: number): PaneLayoutState =>
		layout(
			[
				tile("chat", chatFlex),
				stack("column", columnFlex, [tile("changes", 1), tile("files", 1)]),
				tile("plan", planFlex),
			],
			"plan",
		);

	it("grows the chat to 320 on the first open at 700", () =>
	{
		expect(openFitted(700, "files")).toEqual([layout([tile("chat", 0.915594), tile("files", 1.084406)], "files")]);
	});

	it("leaves the default split at 1272", () =>
	{
		expect(openFitted(1272, "files")).toEqual([layout([tile("chat", 2), tile("files", 3)], "files")]);
	});

	it("fits the third open into a new column at 984", () =>
	{
		expect(openFitted(984, "changes", "files", "plan").at(-1)).toEqual(fittedColumns(0.977597, 1.167006, 0.855397));
	});

	it("fits only the third open at 900", () =>
	{
		expect(openFitted(900, "changes", "files", "plan")).toEqual([
			layout([tile("chat", 2), tile("changes", 3)], "changes"),
			layout([tile("chat", 2), stack("column", 3, [tile("changes", 1), tile("files", 1)])], "files"),
			fittedColumns(1.069042, 0.995546, 0.935412),
		]);
	});

	it("fits only the root row when reopening into a closed slot", () =>
	{
		const open: PaneLayoutState =
		{
			root: stack("row", 1, [
				tile("files", 3),
				stack("column", 2, [stack("row", 1, [tile("chat", 1), tile("plan", 1)]), tile("background-tasks", 1)]),
			]),
			expanded: null,
			focused: "background-tasks",
		};
		const closed = closePane(open, "background-tasks");
		expect(
			{
				slotted: closed.closedSlots?.["background-tasks"] !== undefined,
				reopened: openPane(
					closed,
					"background-tasks",
					{},
					{
						widthPx: 900,
					},
				),
			},
		).toEqual(
			{
				slotted: true,
				reopened:
				{
					root: stack("row", 1, [
						tile("files", 0.662959),
						stack("column", 1.337041, [
							stack("row", 1, [tile("chat", 1), tile("plan", 1)]),
							tile("background-tasks", 1),
						]),
					]),
					expanded: null,
					focused: "background-tasks",
				},
			},
		);
	});

	it("never fits a focus of an already-open pane", () =>
	{
		const open = layout([tile("chat", 2), tile("files", 3)], "chat");
		expect(
			openPane(
				open,
				"files",
				{},
				{
					widthPx: 700,
				},
			),
		).toEqual(layout([tile("chat", 2), tile("files", 3)], "files"));
	});
});

describe("resolveTileLayout (upstream walkResolvedFlexes)", () =>
{
	function entry(flex: number, width: number, height: number, minWidthPx: number, minHeightPx: number | null)
	{
		return {
			flex,
			width,
			height,
			minWidthPx,
			minHeightPx,
		};
	}

	function resolved(
		root: StackNode,
		box:
		{
			width: number;
			height: number;
		},
	)
	{
		return Object.fromEntries(
			[...resolveTileLayout(root, box)].map(([key, value]) => [
				key,
				{
					...value,
					flex: Math.round(value.flex * 1e6) / 1e6,
				},
			]),
		);
	}

	const chatPlan = stack("row", 1, [tile("chat", 2), tile("plan", 1)]);
	const threeColumns = stack("row", 1, [
		tile("chat", 2),
		stack("column", 3, [tile("changes", 1), tile("files", 1)]),
		tile("plan", 1),
	]);
	const nestedRow = stack("row", 1, [
		tile("files", 3),
		stack("column", 2, [stack("row", 1, [tile("chat", 1), tile("plan", 1)]), tile("background-tasks", 1)]),
	]);
	const chatColumn = stack("row", 1, [tile("chat", 1), stack("column", 1, [tile("plan", 1), tile("files", 1)])]);

	it.each([
		[
			"[chat:2, plan:1] at 984",
			chatPlan,
			984,
			800,
			{
				"0": entry(1.332655, 655, 800, 100, 100),
				"1": entry(0.667345, 328, 800, 280, 100),
			},
		],
		[
			"[chat:2, plan:1] at 700",
			chatPlan,
			700,
			800,
			{
				"0": entry(1.198856, 419, 800, 100, 100),
				"1": entry(0.801144, 280, 800, 280, 100),
			},
		],
		[
			"[chat:2, plan:1] at 560",
			chatPlan,
			560,
			800,
			{
				"0": entry(0.998211, 279, 800, 100, 100),
				"1": entry(1.001789, 280, 800, 280, 100),
			},
		],
		[
			"[chat:2, plan:1] at 450",
			chatPlan,
			450,
			800,
			{
				"0": entry(0.752784, 169, 800, 100, 100),
				"1": entry(1.247216, 280, 800, 280, 100),
			},
		],
		[
			"[chat:2, plan:1] at 380",
			chatPlan,
			380,
			800,
			{
				"0": entry(0.527704, 100, 800, 100, 100),
				"1": entry(1.472296, 279, 800, 279, 100),
			},
		],
		[
			"[chat:2, plan:1] at 300",
			chatPlan,
			300,
			800,
			{
				"0": entry(0.528428, 79, 800, 79, 100),
				"1": entry(1.471572, 220, 800, 220, 100),
			},
		],
		[
			"a third root column at 984",
			threeColumns,
			984,
			800,
			{
				"0": entry(0.858452, 281, 800, 100, 100),
				"1": entry(1.286151, 421, 800, 280, null),
				"1.0": entry(1.001252, 421, 400, 280, 100),
				"1.1": entry(0.998748, 421, 399, 280, 100),
				"2": entry(0.855397, 280, 800, 280, 100),
			},
		],
		[
			"a third root column at 800",
			threeColumns,
			800,
			800,
			{
				"0": entry(0.778195, 207, 800, 100, 100),
				"1": entry(1.169173, 311, 800, 280, null),
				"1.0": entry(1.001252, 311, 400, 280, 100),
				"1.1": entry(0.998748, 311, 399, 280, 100),
				"2": entry(1.052632, 280, 800, 280, 100),
			},
		],
		[
			"a nested row inside a column at 900",
			nestedRow,
			900,
			800,
			{
				"0": entry(1.152392, 518, 800, 280, 100),
				"1": entry(0.847608, 381, 800, 381, null),
				"1.0": entry(1.001252, 381, 400, 0, null),
				"1.0.0": entry(0.526316, 100, 400, 100, 100),
				"1.0.1": entry(1.473684, 280, 400, 280, 100),
				"1.1": entry(0.998748, 381, 399, 280, 100),
			},
		],
		[
			"short column children at 900x150",
			chatColumn,
			900,
			150,
			{
				"0": entry(1.001112, 450, 150, 100, 100),
				"1": entry(0.998888, 449, 150, 280, null),
				"1.0": entry(1.006711, 449, 75, 280, 74),
				"1.1": entry(0.993289, 449, 74, 280, 73),
			},
		],
		[
			"a column floored at 280 at 500",
			chatColumn,
			500,
			800,
			{
				"0": entry(0.877756, 219, 800, 100, 100),
				"1": entry(1.122244, 280, 800, 280, null),
				"1.0": entry(1.001252, 280, 400, 280, 100),
				"1.1": entry(0.998748, 280, 399, 280, 100),
			},
		],
	] satisfies Array<[string, StackNode, number, number, Record<string, ReturnType<typeof entry>>]>)(
		"%s",
		(_name, root, width, height, expected) =>
		{
			expect(
				resolved(
					root,
					{
						width,
						height,
					},
				),
			).toStrictEqual(expected);
		},
	);
});

describe("leftEdgeTiles", () =>
{
	it.each([
		[
			"the first root child",
			stack("row", 1, [tile("files", 1), stack("column", 1, [tile("chat", 1), tile("plan", 1)])]),
			["files"],
		],
		[
			"every tile of a first column",
			stack("row", 1, [stack("column", 1, [tile("chat", 1), tile("plan", 1)]), tile("files", 1)]),
			["chat", "plan"],
		],
	] satisfies Array<[string, StackNode, TileId[]]>)("holds %s", (_name, root, expected) =>
	{
		expect(leftEdgeTiles(root)).toStrictEqual(new Set(expected));
	});
});

describe("rowEndOnlyTileIds", () =>
{
	it.each([
		["a sole chat", stack("row", 1, [tile("chat", 1)]), []],
		["a pane right of the chat", stack("row", 1, [tile("chat", 1), tile("files", 1)]), ["files"]],
		["the chat right of a pane", stack("row", 1, [tile("files", 1), tile("chat", 1)]), ["chat"]],
		[
			"every tile of a right column",
			stack("row", 1, [tile("chat", 1), stack("column", 1, [tile("files", 1), tile("changes", 1)])]),
			["files", "changes"],
		],
		["only the last of three", stack("row", 1, [tile("chat", 1), tile("files", 1), tile("plan", 1)]), ["plan"]],
		[
			"the last tile of a nested row",
			stack("row", 1, [tile("chat", 1), stack("row", 1, [tile("files", 1), tile("changes", 1)])]),
			["changes"],
		],
	] satisfies Array<[string, StackNode, TileId[]]>)("holds %s", (_name, root, expected) =>
	{
		expect(rowEndOnlyTileIds(root)).toStrictEqual(new Set(expected));
	});
});

describe("resizeDivider", () =>
{
	it.each([
		[
			"moves the divider by the pixel delta",
			ONE_PANE,
			{
				path: [],
				index: 0,
				deltaPx: 100,
				sizePx: 1212,
			},
			layout([tile("chat", 2.25), tile("background-tasks", 0.75)], "background-tasks"),
		],
		[
			"clamps the pane to its 280px minimum",
			ONE_PANE,
			{
				path: [],
				index: 0,
				deltaPx: 200,
				sizePx: 1212,
			},
			layout([tile("chat", 2.3), tile("background-tasks", 0.7)], "background-tasks"),
		],
		[
			"clamps chat to its 320px minimum",
			ONE_PANE,
			{
				path: [],
				index: 0,
				deltaPx: -600,
				sizePx: 1212,
			},
			layout([tile("chat", 0.8), tile("background-tasks", 2.2)], "background-tasks"),
		],
		[
			"resizes inside a nested column",
			TWO_PANES,
			{
				path: [1],
				index: 0,
				deltaPx: 200,
				sizePx: 812,
			},
			layout(
				[tile("chat", 2), stack("column", 1, [tile("background-tasks", 1.3), tile("changes", 0.7)])],
				"changes",
			),
		],
		[
			"clamps a column to its widest child's minimum",
			THREE_PANES,
			{
				path: [],
				index: 0,
				deltaPx: 200,
				sizePx: 1624,
			},
			layout(
				[
					tile("chat", 2.3),
					stack("column", 0.7, [tile("background-tasks", 1), tile("changes", 1)]),
					tile("files", 1),
				],
				"files",
			),
		],
		[
			"keeps the narrower side column at or above 280px",
			layout([tile("chat", 2), tile("files", 3), tile("changes", 2.25)], "files"),
			{
				path: [],
				index: 1,
				deltaPx: 300,
				sizePx: 1474,
			},
			layout([tile("chat", 2), tile("files", 3.85), tile("changes", 1.4)], "files"),
		],
	] satisfies Array<
		[
			string,
			PaneLayoutState,
			{
				path: number[];
				index: number;
				deltaPx: number;
				sizePx: number;
			},
			PaneLayoutState,
		]
	>)("%s", (_name, state, request, expected) =>
	{
		expect(resizeDivider(state, request)).toEqual(expected);
	});

	it.each([
		[
			"an unknown stack path",
			{
				path: [5],
				index: 0,
				deltaPx: 10,
				sizePx: 1000,
			},
		],
		[
			"a path to a tile",
			{
				path: [0],
				index: 0,
				deltaPx: 10,
				sizePx: 1000,
			},
		],
		[
			"a divider index past the end",
			{
				path: [],
				index: 1,
				deltaPx: 10,
				sizePx: 1000,
			},
		],
	])("ignores %s", (_name, request) =>
	{
		expect(resizeDivider(ONE_PANE, request)).toBe(ONE_PANE);
	});

	const CHAT_PLAN = layout([tile("chat", 2), tile("plan", 1)], "plan");
	const RESOLVED_700 = [1.198856, 0.801144];

	it.each([
		["holds a pane already at its floor", 24, "full", [1.198856, 0.801144]],
		["moves from the rendered boundary, not the raw flexes", -24, "full", [1.130186, 0.869814]],
		["stops a pointer drag at the chat's reachable 100px floor", -400, "reachable", [0.286123, 1.713877]],
		["stops a key step at the chat's full 320px floor", -400, "full", [0.915594, 1.084406]],
	] satisfies Array<[string, number, "reachable" | "full", number[]]>)(
		"%s (upstream Xt over resolved flexes)",
		(_name, deltaPx, floor, expected) =>
		{
			const next = resizeDivider(
				CHAT_PLAN,
				{
					path: [],
					index: 0,
					deltaPx,
					sizePx: 700,
					startFlexes: RESOLVED_700,
					floor,
				},
			);
			expect(next).toStrictEqual(
				layout([tile("chat", expected[0] ?? 0), tile("plan", expected[1] ?? 0)], "plan"),
			);
		},
	);
});

describe("fitPhoneLayout", () =>
{
	it("reflows a saved multi-column layout into one stacked side column, as a fresh phone open builds it", () =>
	{
		expect(fitPhoneLayout(THREE_PANES)).toStrictEqual(
			layout(
				[
					tile("chat", 2),
					stack("column", 3, [tile("background-tasks", 1), tile("changes", 1), tile("files", 1)]),
				],
				"files",
			),
		);
	});

	it("puts the chat first when a saved layout nests it in a column", () =>
	{
		const nested = layout(
			[tile("files", 1), stack("column", 1, [tile("plan", 1), tile("chat", 1)]), tile("changes", 1)],
			"chat",
			"changes",
		);
		expect(fitPhoneLayout(nested)).toStrictEqual(
			layout(
				[tile("chat", 2), stack("column", 3, [tile("files", 1), tile("plan", 1), tile("changes", 1)])],
				"chat",
				"changes",
			),
		);
	});

	it("leaves a layout that already fits a phone untouched", () =>
	{
		expect(
			[ONE_PANE, TWO_PANES, defaultPaneLayout()].map((state) => fitPhoneLayout(state) === state),
		).toStrictEqual([true, true, true]);
	});
});

describe("togglePane", () =>
{
	it("collapses another pane's expansion instead of closing the toggled pane, as upstream toggleSidePane", () =>
	{
		expect(
			{
				otherExpanded: togglePane(expandPane(TWO_PANES, "background-tasks"), "changes"),
				selfExpanded: togglePane(expandPane(TWO_PANES, "changes"), "changes"),
				open: togglePane(TWO_PANES, "changes"),
				closed: togglePane(ONE_PANE, "files"),
				closedWhileExpanded: togglePane(expandPane(ONE_PANE, "background-tasks"), "files"),
				phone: updatePhoneView(THREE_PANES, (state) =>
					togglePane(expandPane(state, "background-tasks"), "changes"),
				),
			},
		).toStrictEqual(
			{
				otherExpanded:
				{
					...TWO_PANES,
					expanded: null,
					focused: "background-tasks",
				},
				selfExpanded: closePane(expandPane(TWO_PANES, "changes"), "changes"),
				open: closePane(TWO_PANES, "changes"),
				closed: openPane(ONE_PANE, "files"),
				closedWhileExpanded:
				{
					...openPane(expandPane(ONE_PANE, "background-tasks"), "files"),
					expanded: null,
				},
				phone:
				{
					...THREE_PANES,
					expanded: null,
					focused: "background-tasks",
				},
			},
		);
	});
});

describe("updatePhoneView", () =>
{
	it("keeps the saved columns when a phone tap only focuses or expands a pane", () =>
	{
		const focused = updatePhoneView(THREE_PANES, (state) => focusPane(state, "changes"));
		const expanded = updatePhoneView(THREE_PANES, (state) => expandPane(state, "background-tasks"));
		expect(
			{
				focused,
				expanded,
			},
		).toStrictEqual(
			{
				focused:
				{
					...THREE_PANES,
					focused: "changes",
				},
				expanded:
				{
					...THREE_PANES,
					expanded: "background-tasks",
					focused: "background-tasks",
				},
			},
		);
	});

	it("closes a pane from the saved columns rather than saving the phone shape", () =>
	{
		expect(updatePhoneView(THREE_PANES, (state) => closePane(state, "changes"))).toStrictEqual(
			slotted(
				layout([tile("chat", 2), tile("background-tasks", 1), tile("files", 1)], "files"),
				"changes",
				CHANGES_UNDER_BACKGROUND_TASKS,
			),
		);
	});

	it("opens a pane into the saved columns", () =>
	{
		expect(updatePhoneView(THREE_PANES, (state) => openPane(state, "plan"))).toStrictEqual(
			layout(
				[
					tile("chat", 2),
					stack("column", 1, [tile("background-tasks", 1), tile("changes", 1)]),
					stack("column", 1, [tile("files", 1), tile("plan", 1)]),
				],
				"plan",
			),
		);
	});

	it("saves the phone shape once a phone resize rearranges the stacked column", () =>
	{
		const view = fitPhoneLayout(THREE_PANES);
		const resized = resizeDivider(
			view,
			{
				path: [1],
				index: 0,
				deltaPx: 50,
				sizePx: 900,
			},
		);
		expect(updatePhoneView(THREE_PANES, () => resized)).toStrictEqual(resized);
	});

	it("applies the update directly when the layout already fits", () =>
	{
		expect(updatePhoneView(TWO_PANES, (state) => closePane(state, "changes"))).toStrictEqual(
			slotted(
				layout([tile("chat", 2), tile("background-tasks", 1)], "background-tasks"),
				"changes",
				CHANGES_UNDER_BACKGROUND_TASKS,
			),
		);
	});
});

describe("unprompted overlay (upstream c03935b01 eu/ql/Zl/G, cf53e1812 ue)", () =>
{
	const CHAT_ONLY = defaultPaneLayout();

	it("opens an unprompted pane beside a lone chat as an overlay over the normal split, keeping focus", () =>
	{
		const plain = openPane(CHAT_ONLY, "plan");
		const opened = openPane(
			CHAT_ONLY,
			"plan",
			{},
			undefined,
			{
				unprompted: true,
			},
		);

		expect(
			{
				root: opened.root,
				focused: opened.focused,
				overlay: overlayTile(opened),
				overlayRoot: opened.overlay?.root === opened.root,
				paneFlex: opened.overlay?.paneFlex,
			},
		).toStrictEqual(
			{
				root: plain.root,
				focused: "chat",
				overlay: "plan",
				overlayRoot: true,
				paneFlex: undefined,
			},
		);
	});

	it.each([
		[
			"an arrival",
			CHAT_ONLY,
			{
				unprompted: true,
				arrival: true,
			},
		],
		["a user open", CHAT_ONLY, {}],
		[
			"a second pane",
			ONE_PANE,
			{
				unprompted: true,
			},
		],
	])("splits for %s", (_label, state, options) =>
	{
		const opened = openPane(state, "plan", {}, undefined, options);

		expect(
			{
				overlay: overlayTile(opened),
				stored: opened.overlay,
			},
		).toStrictEqual(
			{
				overlay: null,
				stored: undefined,
			},
		);
	});

	it("settles into the split with the synced pane flex", () =>
	{
		const opened = openPane(
			CHAT_ONLY,
			"plan",
			{},
			undefined,
			{
				unprompted: true,
			},
		);
		const settled = settleOverlay(syncOverlayPaneFlex(opened, "plan", 0.4));

		expect(settled).toStrictEqual(layout([tile("chat", 2), tile("plan", 0.4)], "chat"));
	});

	it("keeps the split's flex when settling before a sync, and reports no overlay once the root changes", () =>
	{
		const opened = openPane(
			CHAT_ONLY,
			"plan",
			{},
			undefined,
			{
				unprompted: true,
			},
		);
		const resized =
		{
			...opened,
			root: stack("row", 1, [tile("chat", 3), tile("plan", 1)]),
		};

		expect(
			{
				settled: settleOverlay(opened),
				stale: overlayTile(resized),
				expanded: overlayTile(expandPane(opened, "plan")),
				expandedFlex: expandPane(syncOverlayPaneFlex(opened, "plan", 0.4), "plan"),
			},
		).toStrictEqual(
			{
				settled: layout([tile("chat", 2), tile("plan", 1)], "chat"),
				stale: null,
				expanded: null,
				expandedFlex: layout([tile("chat", 2), tile("plan", 0.4)], "plan", "plan"),
			},
		);
	});

	it("never persists the overlay", () =>
	{
		const storage = new MemoryStorage();
		const opened = openPane(
			CHAT_ONLY,
			"plan",
			{},
			undefined,
			{
				unprompted: true,
			},
		);
		savePaneLayout("s", opened, storage);

		expect(JSON.parse(storage.getItem(PANE_LAYOUT_STORAGE_KEY) ?? "null")).toStrictEqual(
			{
				s: layout([tile("chat", 2), tile("plan", 1)], "chat"),
			},
		);
	});
});

describe("persistence", () =>
{
	it("round-trips a layout per session under one storage key", () =>
	{
		const storage = new MemoryStorage();
		savePaneLayout("session-a", THREE_PANES, storage);
		savePaneLayout("session-b", ONE_PANE, storage);

		expect(loadPaneLayout("session-a", storage)).toEqual(THREE_PANES);
		expect(loadPaneLayout("session-b", storage)).toEqual(ONE_PANE);
		expect(JSON.parse(storage.getItem(PANE_LAYOUT_STORAGE_KEY) ?? "null")).toEqual(
			{
				"session-a": THREE_PANES,
				"session-b": ONE_PANE,
			},
		);
	});

	it("returns the default for an unknown session", () =>
	{
		expect(loadPaneLayout("missing", new MemoryStorage())).toEqual(defaultPaneLayout());
	});

	it.each([
		["corrupt JSON", "{not json"],
		[
			"an unknown field",
			JSON.stringify(
				{
					s:
					{
						...ONE_PANE,
						extra: true,
					},
				},
			),
		],
		[
			"a duplicate tile",
			JSON.stringify(
				{
					s: layout([tile("chat", 1), tile("files", 1), tile("files", 1)], "chat"),
				},
			),
		],
		[
			"a missing chat tile",
			JSON.stringify(
				{
					s: layout([tile("files", 1)], "files"),
				},
			),
		],
		[
			"an expanded pane that is not open",
			JSON.stringify(
				{
					s:
					{
						...ONE_PANE,
						expanded: "files",
					},
				},
			),
		],
		[
			"a non-positive flex",
			JSON.stringify(
				{
					s: layout([tile("chat", 0)], "chat"),
				},
			),
		],
	])("falls back to the default for %s", (_name, raw) =>
	{
		const storage = new MemoryStorage();
		storage.setItem(PANE_LAYOUT_STORAGE_KEY, raw);
		expect(loadPaneLayout("s", storage)).toEqual(defaultPaneLayout());
	});

	it("overwrites a corrupt blob on save", () =>
	{
		const storage = new MemoryStorage();
		storage.setItem(PANE_LAYOUT_STORAGE_KEY, "{not json");
		savePaneLayout("s", ONE_PANE, storage);
		expect(JSON.parse(storage.getItem(PANE_LAYOUT_STORAGE_KEY) ?? "null")).toEqual(
			{
				s: ONE_PANE,
			},
		);
	});

	it("is a no-op when storage throws", () =>
	{
		const storage = new ThrowingStorage();
		expect(loadPaneLayout("s", storage)).toEqual(defaultPaneLayout());
		expect(() =>
		{
			savePaneLayout("s", ONE_PANE, storage);
		}).not.toThrow();
	});

	it("is a no-op without storage", () =>
	{
		expect(loadPaneLayout("s", null)).toEqual(defaultPaneLayout());
		expect(() =>
		{
			savePaneLayout("s", ONE_PANE, null);
		}).not.toThrow();
	});
});

describe("changes scope persistence", () =>
{
	it("keeps the Changes scope per session beside the layout, surviving layout saves", () =>
	{
		const storage = new MemoryStorage();
		savePaneLayout("session-a", ONE_PANE, storage);
		saveChangesScope("session-a", "commit:07bc05d", storage);
		saveChangesScope("session-b", "uncommitted", storage);
		savePaneLayout("session-a", TWO_PANES, storage);

		expect(
			{
				scopes: [loadChangesScope("session-a", storage), loadChangesScope("session-b", storage)],
				layouts: [loadPaneLayout("session-a", storage), loadPaneLayout("session-b", storage)],
				stored: JSON.parse(storage.getItem(PANE_LAYOUT_STORAGE_KEY) ?? "null"),
			},
		).toEqual(
			{
				scopes: ["commit:07bc05d", "uncommitted"],
				layouts: [TWO_PANES, defaultPaneLayout()],
				stored:
				{
					"session-a":
					{
						...TWO_PANES,
						changesScope: "commit:07bc05d",
					},
					"session-b":
					{
						...defaultPaneLayout(),
						changesScope: "uncommitted",
					},
				},
			},
		);
	});

	it("defaults to the branch scope", () =>
	{
		const storage = new MemoryStorage();
		savePaneLayout("s", ONE_PANE, storage);
		expect([
			loadChangesScope("s", storage),
			loadChangesScope("missing", storage),
			loadChangesScope("s", null),
			loadChangesScope("s", new ThrowingStorage()),
		]).toEqual(["branch", "branch", "branch", "branch"]);
	});

	it("rejects a malformed stored scope", () =>
	{
		const storage = new MemoryStorage();
		storage.setItem(
			PANE_LAYOUT_STORAGE_KEY,
			JSON.stringify(
				{
					s:
					{
						...ONE_PANE,
						changesScope: "commit:not-a-sha",
					},
				},
			),
		);
		expect([loadChangesScope("s", storage), loadPaneLayout("s", storage)]).toEqual(["branch", defaultPaneLayout()]);
	});

	it("is a no-op when storage throws or is missing", () =>
	{
		expect(() =>
		{
			saveChangesScope("s", "session", new ThrowingStorage());
		}).not.toThrow();
		expect(() =>
		{
			saveChangesScope("s", "session", null);
		}).not.toThrow();
	});
});

describe("subagent pane focus persistence", () =>
{
	const SUBAGENT_PANE = layout([tile("chat", 2), tile("subagents", 1)], "subagents");

	it("keeps the focused agent per session while the Subagent pane stays open", () =>
	{
		const storage = new MemoryStorage();
		savePaneLayout("session-a", SUBAGENT_PANE, storage);
		saveSubagentPaneAgent("session-a", "agent-a1", storage);
		savePaneLayout(
			"session-a",
			{
				...SUBAGENT_PANE,
				focused: "chat",
			},
			storage,
		);

		expect(
			{
				focused: [loadSubagentPaneAgent("session-a", storage), loadSubagentPaneAgent("session-b", storage)],
				stored: JSON.parse(storage.getItem(PANE_LAYOUT_STORAGE_KEY) ?? "null"),
			},
		).toEqual(
			{
				focused: ["agent-a1", null],
				stored:
				{
					"session-a":
					{
						...SUBAGENT_PANE,
						focused: "chat",
						subagentId: "agent-a1",
					},
				},
			},
		);
	});

	it("forgets the focused agent when the pane closes or Back clears it", () =>
	{
		const storage = new MemoryStorage();
		savePaneLayout("closed", SUBAGENT_PANE, storage);
		saveSubagentPaneAgent("closed", "agent-a1", storage);
		savePaneLayout("closed", ONE_PANE, storage);
		savePaneLayout("back", SUBAGENT_PANE, storage);
		saveSubagentPaneAgent("back", "agent-a1", storage);
		saveSubagentPaneAgent("back", null, storage);

		expect(JSON.parse(storage.getItem(PANE_LAYOUT_STORAGE_KEY) ?? "null")).toEqual(
			{
				closed: ONE_PANE,
				back: SUBAGENT_PANE,
			},
		);
	});

	it("is a no-op when storage throws or is missing", () =>
	{
		expect([
			loadSubagentPaneAgent("s", new ThrowingStorage()),
			loadSubagentPaneAgent("s", null),
			(() =>
			{
				saveSubagentPaneAgent("s", "agent-a1", new ThrowingStorage());
				saveSubagentPaneAgent("s", "agent-a1", null);
				return "ok";
			})(),
		]).toEqual([null, null, "ok"]);
	});
});

describe("chatGutters and chatShellPadding (upstream cf53e1812 ne/Q/Z, shared-20 it)", () =>
{
	it.each([
		{
			name: "[chat]",
			root: stack("row", 1, [tile("chat", 1)]),
			gutters:
			{
				start: undefined,
				end: "bleed",
			},
			padding: "0px 0px 8px 8px",
		},
		{
			name: "[chat, files]",
			root: stack("row", 1, [tile("chat", 1), tile("files", 1)]),
			gutters:
			{
				start: undefined,
				end: "shave",
			},
			padding: "0px 0px 8px 8px",
		},
		{
			name: "[files, chat]",
			root: stack("row", 1, [tile("files", 1), tile("chat", 1)]),
			gutters:
			{
				start: "shave",
				end: "bleed",
			},
			padding: "0px 0px 8px 0px",
		},
		{
			name: "[files, chat, changes]",
			root: stack("row", 1, [tile("files", 1), tile("chat", 1), tile("changes", 1)]),
			gutters:
			{
				start: "shave",
				end: "shave",
			},
			padding: "0px 0px 8px 0px",
		},
		{
			name: "[files, column[changes, chat]]",
			root: stack("row", 1, [tile("files", 1), stack("column", 1, [tile("changes", 1), tile("chat", 1)])]),
			gutters:
			{
				start: "shave",
				end: undefined,
			},
			padding: "0px 8px 8px 0px",
		},
		{
			name: "[files, column[chat, changes]]",
			root: stack("row", 1, [tile("files", 1), stack("column", 1, [tile("chat", 1), tile("changes", 1)])]),
			gutters:
			{
				start: "shave",
				end: "bleed",
			},
			padding: "0px 0px 8px 0px",
		},
		{
			name: "[column[chat, files], changes]",
			root: stack("row", 1, [stack("column", 1, [tile("chat", 1), tile("files", 1)]), tile("changes", 1)]),
			gutters:
			{
				start: undefined,
				end: "shave",
			},
			padding: "0px 0px 8px 8px",
		},
	])("$name", ({root, gutters, padding}) =>
	{
		const actual = chatGutters(root);
		expect(
			{
				gutters: actual,
				padding: chatShellPadding(actual),
			},
		).toStrictEqual(
			{
				gutters,
				padding,
			},
		);
	});

	it("swaps start and end in RTL", () =>
	{
		expect(chatShellPadding(chatGutters(stack("row", 1, [tile("chat", 1), tile("files", 1)])), true)).toBe(
			"0px 8px 8px 0px",
		);
	});
});

describe("topEdgeTiles and wideRowTopPadding (upstream cf53e1812 ae, shared-20 it's top)", () =>
{
	it.each([
		["the lone chat", stack("row", 1, [tile("chat", 1)]), ["chat"]],
		["every child of a row", stack("row", 1, [tile("chat", 1), tile("files", 1)]), ["chat", "files"]],
		[
			"only a column's first child",
			stack("row", 1, [tile("files", 1), stack("column", 1, [tile("chat", 1), tile("changes", 1)])]),
			["files", "chat"],
		],
		[
			"a pane above the chat",
			stack("row", 1, [stack("column", 1, [tile("files", 1), tile("chat", 1)]), tile("changes", 1)]),
			["files", "changes"],
		],
		[
			"a row nested at a column's top",
			stack("row", 1, [
				tile("files", 1),
				stack("column", 1, [stack("row", 1, [tile("chat", 1), tile("plan", 1)]), tile("terminal", 1)]),
			]),
			["files", "chat", "plan"],
		],
	] satisfies Array<[string, StackNode, TileId[]]>)("holds %s", (_name, root, expected) =>
	{
		expect(topEdgeTiles(root)).toStrictEqual(new Set(expected));
	});

	const chatAndFiles = stack("row", 1, [tile("chat", 1), tile("files", 1)]);
	const filesOverChanges = stack("row", 1, [
		tile("chat", 1),
		stack("column", 1, [tile("files", 1), tile("changes", 1)]),
	]);

	it.each([
		["the chat", "chat", chatAndFiles, "tall", undefined],
		["a top pane while nothing is lifted", "files", chatAndFiles, null, undefined],
		["a pane under another in a column", "changes", filesOverChanges, "tall", undefined],
		["a top pane under the tall row", "files", chatAndFiles, "tall", "var(--wide-title-row-h)"],
		["a column's top pane under the short row", "files", filesOverChanges, "short", "var(--wide-title-row-h)"],
	] satisfies Array<[string, TileId, StackNode, "tall" | "short" | null, string | undefined]>)(
		"pads %s with %s",
		(_name, tileId, root, under, expected) =>
		{
			expect(wideRowTopPadding(tileId, root, under)).toBe(expected);
		},
	);
});

describe("movePaneToEdge", () =>
{
	it.each<[string, PaneLayoutState, TileId, "left" | "right" | "top" | "bottom", PaneLayoutState]>([
		[
			"splits a nested tile onto the end of the same-axis root",
			TWO_PANES,
			"changes",
			"right",
			layout([tile("chat", 2), tile("background-tasks", 1), tile("changes", 1)], "changes"),
		],
		[
			"inserts a root child at the start, keeping its flex",
			ONE_PANE,
			"background-tasks",
			"left",
			layout([tile("background-tasks", 1), tile("chat", 2)], "background-tasks"),
		],
		[
			"wraps the root in a perpendicular stack",
			ONE_PANE,
			"background-tasks",
			"top",
			{
				root: stack("column", 1, [tile("background-tasks", 1), tile("chat", 1)]),
				expanded: null,
				focused: "background-tasks",
			},
		],
		[
			"wraps the root after the tile for a trailing perpendicular edge",
			layout([tile("chat", 2), tile("background-tasks", 1)], "chat"),
			"background-tasks",
			"bottom",
			{
				root: stack("column", 1, [tile("chat", 1), tile("background-tasks", 1)]),
				expanded: null,
				focused: "background-tasks",
			},
		],
		[
			"collapses an expanded pane it moves",
			layout([tile("chat", 2), tile("background-tasks", 1)], "background-tasks", "background-tasks"),
			"background-tasks",
			"left",
			layout([tile("background-tasks", 1), tile("chat", 2)], "background-tasks"),
		],
		[
			"descends through single-child stacks to the first real split",
			{
				root: stack("row", 1, [stack("column", 1, [tile("chat", 1), tile("files", 1)])]),
				expanded: null,
				focused: "chat",
			},
			"chat",
			"bottom",
			{
				root: stack("row", 1, [stack("column", 1, [tile("files", 1), tile("chat", 1)])]),
				expanded: null,
				focused: "chat",
			},
		],
	])("%s", (_name, state, tileId, edge, expected) =>
	{
		expect(movePaneToEdge(state, tileId, edge)).toStrictEqual(expected);
	});

	it("returns the same state when the pane already holds that edge", () =>
	{
		expect(movePaneToEdge(ONE_PANE, "background-tasks", "right")).toBe(ONE_PANE);
	});
});

describe("paneAtEdge", () =>
{
	it.each<[PaneLayoutState, TileId, Record<string, boolean>]>([
		[
			ONE_PANE,
			"background-tasks",
			{
				left: false,
				right: true,
				top: false,
				bottom: false,
			},
		],
		[
			ONE_PANE,
			"chat",
			{
				left: true,
				right: false,
				top: false,
				bottom: false,
			},
		],
		[
			TWO_PANES,
			"changes",
			{
				left: false,
				right: false,
				top: false,
				bottom: false,
			},
		],
		[
			layout([tile("chat", 1)], "chat"),
			"chat",
			{
				left: true,
				right: true,
				top: true,
				bottom: true,
			},
		],
	])("%#", (state, tileId, expected) =>
	{
		const edges = ["left", "right", "top", "bottom"] as const;
		expect(Object.fromEntries(edges.map((edge) => [edge, paneAtEdge(state, tileId, edge)]))).toStrictEqual(
			expected,
		);
	});
});
