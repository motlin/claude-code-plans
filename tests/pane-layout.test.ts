import {describe, expect, it} from "vite-plus/test";
import {
	PANE_LAYOUT_STORAGE_KEY,
	type LayoutNode,
	type MovePreview,
	type PaneKind,
	type PaneLayoutState,
	type StackNode,
	type TileId,
	closePane,
	collapsePane,
	defaultPaneLayout,
	expandPane,
	focusPane,
	loadChangesScope,
	loadPaneLayout,
	loadSubagentPaneAgent,
	minTileSize,
	movePane,
	movePreview,
	openPane,
	resizeDivider,
	saveChangesScope,
	savePaneLayout,
	saveSubagentPaneAgent,
} from "../src/lib/pane-layout";

function tile(tileId: TileId, flex: number): LayoutNode {
	return {kind: "tile", tileId, flex};
}

function stack(direction: "row" | "column", flex: number, children: LayoutNode[]): StackNode {
	return {kind: "stack", direction, flex, children};
}

function layout(children: LayoutNode[], focused: TileId, expanded: PaneKind | null = null): PaneLayoutState {
	return {root: stack("row", 1, children), expanded, focused};
}

function openAll(...kinds: PaneKind[]): PaneLayoutState {
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

class ThrowingStorage implements Storage {
	readonly length = 0;
	clear(): void {
		throw new Error("denied");
	}
	getItem(): string | null {
		throw new Error("denied");
	}
	key(): string | null {
		throw new Error("denied");
	}
	removeItem(): void {
		throw new Error("denied");
	}
	setItem(): void {
		throw new Error("denied");
	}
}

class MemoryStorage implements Storage {
	readonly values = new Map<string, string>();
	get length(): number {
		return this.values.size;
	}
	clear(): void {
		this.values.clear();
	}
	getItem(key: string): string | null {
		return this.values.get(key) ?? null;
	}
	key(index: number): string | null {
		return [...this.values.keys()][index] ?? null;
	}
	removeItem(key: string): void {
		this.values.delete(key);
	}
	setItem(key: string, value: string): void {
		this.values.set(key, value);
	}
}

describe("defaultPaneLayout", () => {
	it("is a single chat tile in a row", () => {
		expect(defaultPaneLayout()).toEqual({
			root: {kind: "stack", direction: "row", flex: 1, children: [tile("chat", 1)]},
			expanded: null,
			focused: "chat",
		});
	});
});

describe("openPane follows upstream placement", () => {
	it.each([
		[
			"1st pane splits the row chat 2 : pane 3",
			["background-tasks"],
			layout([tile("chat", 2), tile("background-tasks", 3)], "background-tasks"),
		],
		[
			"2nd pane stacks under the side column",
			["background-tasks", "plan"],
			layout([tile("chat", 2), stack("column", 3, [tile("background-tasks", 1), tile("plan", 1)])], "plan"),
		],
		[
			"3rd pane opens a new column",
			["background-tasks", "plan", "files"],
			layout(
				[tile("chat", 2), stack("column", 3, [tile("background-tasks", 1), tile("plan", 1)]), tile("files", 1)],
				"files",
			),
		],
		[
			"4th pane stacks under the newest column",
			["background-tasks", "plan", "files", "links"],
			layout(
				[
					tile("chat", 2),
					stack("column", 3, [tile("background-tasks", 1), tile("plan", 1)]),
					stack("column", 1, [tile("files", 1), tile("links", 1)]),
				],
				"links",
			),
		],
		[
			"Changes without a measured row takes a fifth of it",
			["changes"],
			layout([tile("chat", 1), tile("changes", 0.25)], "changes"),
		],
	] satisfies Array<[string, PaneKind[], PaneLayoutState]>)("%s", (_name, kinds, expected) => {
		expect(openAll(...kinds)).toEqual(expected);
	});

	it("opens Files alone at chat 2 : files 3", () => {
		expect(openPane(defaultPaneLayout(), "files")).toEqual(layout([tile("chat", 2), tile("files", 3)], "files"));
	});

	it("opens Changes as its own far-right column at its 280px minimum", () => {
		const state = openAll("files", "background-tasks");
		expect(openPane(state, "changes", 1424)).toEqual(
			layout(
				[
					tile("chat", 2),
					stack("column", 3, [tile("files", 1), tile("background-tasks", 1)]),
					tile("changes", 1.25),
				],
				"changes",
			),
		);
	});

	it("never stacks a later pane into the Changes column", () => {
		const state = openPane(defaultPaneLayout(), "changes", 1412);
		expect([state, openPane(state, "files"), openAll("changes", "plan", "files")]).toEqual([
			layout([tile("chat", 1), tile("changes", 0.25)], "changes"),
			layout([tile("chat", 2), tile("files", 3), tile("changes", 1.25)], "files"),
			layout(
				[tile("chat", 2), stack("column", 3, [tile("plan", 1), tile("files", 1)]), tile("changes", 1.25)],
				"files",
			),
		]);
	});

	it("focuses an already-open pane without changing the tree", () => {
		expect(openPane(THREE_PANES, "background-tasks")).toEqual({
			...THREE_PANES,
			focused: "background-tasks",
		});
	});

	it("leaves expanded mode when another pane opens", () => {
		const expanded = expandPane(ONE_PANE, "background-tasks");
		expect(openPane(expanded, "plan")).toEqual(
			layout([tile("chat", 2), stack("column", 1, [tile("background-tasks", 1), tile("plan", 1)])], "plan"),
		);
	});
});

describe("closePane", () => {
	it.each([
		[
			"closing the middle pane collapses its column",
			THREE_PANES,
			"changes",
			layout([tile("chat", 2), tile("background-tasks", 1), tile("files", 1)], "files"),
		],
		[
			"closing the focused pane focuses chat",
			THREE_PANES,
			"files",
			layout([tile("chat", 2), stack("column", 1, [tile("background-tasks", 1), tile("changes", 1)])], "chat"),
		],
		[
			"closing a stacked pane hands the column's flex to its sibling",
			TWO_PANES,
			"background-tasks",
			layout([tile("chat", 2), tile("changes", 1)], "changes"),
		],
		["closing the last pane restores the default", ONE_PANE, "background-tasks", defaultPaneLayout()],
	] satisfies Array<[string, PaneLayoutState, PaneKind, PaneLayoutState]>)("%s", (_name, state, kind, expected) => {
		expect(closePane(state, kind)).toEqual(expected);
	});

	it("clears expanded mode when the expanded pane closes", () => {
		expect(closePane(expandPane(TWO_PANES, "changes"), "changes")).toEqual(
			layout([tile("chat", 2), tile("background-tasks", 1)], "chat"),
		);
	});

	it("returns the same state when the pane is not open", () => {
		expect(closePane(ONE_PANE, "files")).toBe(ONE_PANE);
	});
});

describe("expand / collapse / focus", () => {
	it("expands an open pane as an overlay and focuses it", () => {
		expect(expandPane(TWO_PANES, "background-tasks")).toEqual({
			...TWO_PANES,
			expanded: "background-tasks",
			focused: "background-tasks",
		});
	});

	it("collapse restores the layout", () => {
		expect(collapsePane(expandPane(TWO_PANES, "background-tasks"))).toEqual({
			...TWO_PANES,
			focused: "background-tasks",
		});
	});

	it("ignores expanding a pane that is not open", () => {
		expect(expandPane(TWO_PANES, "files")).toBe(TWO_PANES);
	});

	it("focuses open tiles only", () => {
		expect(focusPane(TWO_PANES, "chat")).toEqual({...TWO_PANES, focused: "chat"});
		expect(focusPane(TWO_PANES, "files")).toBe(TWO_PANES);
	});
});

describe("movePane", () => {
	it.each([
		[
			"swaps with the neighbouring slot along the row",
			THREE_PANES,
			"files",
			"left",
			layout(
				[
					tile("chat", 2),
					tile("files", 1),
					stack("column", 1, [tile("background-tasks", 1), tile("changes", 1)]),
				],
				"files",
			),
		],
		[
			"swaps within a column",
			TWO_PANES,
			"changes",
			"top",
			layout([tile("chat", 2), stack("column", 1, [tile("changes", 1), tile("background-tasks", 1)])], "changes"),
		],
		[
			"carries its own flex past chat",
			ONE_PANE,
			"background-tasks",
			"left",
			layout([tile("background-tasks", 1), tile("chat", 2)], "background-tasks"),
		],
		[
			"pops out of a column to the left",
			TWO_PANES,
			"changes",
			"left",
			layout([tile("chat", 2), tile("changes", 0.5), tile("background-tasks", 0.5)], "changes"),
		],
		[
			"pops out of a column to the right",
			THREE_PANES,
			"background-tasks",
			"right",
			layout(
				[tile("chat", 2), tile("changes", 0.5), tile("background-tasks", 0.5), tile("files", 1)],
				"background-tasks",
			),
		],
		[
			"swaps chat to the right of the side pane",
			ONE_PANE,
			"chat",
			"right",
			layout([tile("background-tasks", 1), tile("chat", 2)], "chat"),
		],
		[
			"splits below its row neighbour when no column holds it",
			ONE_PANE,
			"background-tasks",
			"bottom",
			layout([stack("column", 1, [tile("chat", 1), tile("background-tasks", 1)])], "background-tasks"),
		],
		[
			"splits chat above its only neighbour",
			ONE_PANE,
			"chat",
			"top",
			layout([stack("column", 1, [tile("chat", 1), tile("background-tasks", 1)])], "chat"),
		],
		[
			"pops out past the edge of the row from a lone column",
			layout([stack("column", 1, [tile("chat", 1), tile("background-tasks", 1)])], "chat"),
			"background-tasks",
			"right",
			layout([tile("chat", 0.5), tile("background-tasks", 0.5)], "background-tasks"),
		],
	] satisfies Array<[string, PaneLayoutState, TileId, "left" | "right" | "top" | "bottom", PaneLayoutState]>)(
		"%s",
		(_name, state, kind, direction, expected) => {
			expect(movePane(state, kind, direction)).toEqual(expected);
		},
	);

	it.each([
		["at the edge of its column", TWO_PANES, "background-tasks", "top"],
		["at the edge of the row", THREE_PANES, "files", "right"],
		["for a pane that is not open", ONE_PANE, "files", "left"],
	] satisfies Array<[string, PaneLayoutState, TileId, "left" | "right" | "top" | "bottom"]>)(
		"is a no-op %s",
		(_name, state, kind, direction) => {
			expect(movePane(state, kind, direction)).toBe(state);
		},
	);
});

describe("movePreview", () => {
	it.each([
		["nothing along the parent stack's axis", ONE_PANE, "background-tasks", "left", null],
		["the neighbour's half for a split", ONE_PANE, "background-tasks", "bottom", {path: [0], side: "bottom"}],
		["chat's neighbour's half for a chat split", ONE_PANE, "chat", "top", {path: [1], side: "top"}],
		["the column's half when popping out", TWO_PANES, "changes", "left", {path: [1], side: "left"}],
		["nothing for a no-op move", ONE_PANE, "files", "bottom", null],
	] satisfies Array<[string, PaneLayoutState, TileId, "left" | "right" | "top" | "bottom", MovePreview | null]>)(
		"shows %s",
		(_name, state, tileId, direction, expected) => {
			expect(movePreview(state, tileId, direction)).toStrictEqual(expected);
		},
	);
});

describe("minTileSize", () => {
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
	] satisfies Array<[string, LayoutNode, "row" | "column", number]>)("%s", (_name, node, axis, expected) => {
		expect(minTileSize(node, axis)).toBe(expected);
	});
});

describe("resizeDivider", () => {
	it.each([
		[
			"moves the divider by the pixel delta",
			ONE_PANE,
			{path: [], index: 0, deltaPx: 100, sizePx: 1212},
			layout([tile("chat", 2.25), tile("background-tasks", 0.75)], "background-tasks"),
		],
		[
			"clamps the pane to its 280px minimum",
			ONE_PANE,
			{path: [], index: 0, deltaPx: 200, sizePx: 1212},
			layout([tile("chat", 2.3), tile("background-tasks", 0.7)], "background-tasks"),
		],
		[
			"clamps chat to its 320px minimum",
			ONE_PANE,
			{path: [], index: 0, deltaPx: -600, sizePx: 1212},
			layout([tile("chat", 0.8), tile("background-tasks", 2.2)], "background-tasks"),
		],
		[
			"resizes inside a nested column",
			TWO_PANES,
			{path: [1], index: 0, deltaPx: 200, sizePx: 812},
			layout(
				[tile("chat", 2), stack("column", 1, [tile("background-tasks", 1.3), tile("changes", 0.7)])],
				"changes",
			),
		],
		[
			"clamps a column to its widest child's minimum",
			THREE_PANES,
			{path: [], index: 0, deltaPx: 200, sizePx: 1624},
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
			"keeps the far-right Changes column at or above 280px",
			layout([tile("chat", 2), tile("files", 3), tile("changes", 2.25)], "files"),
			{path: [], index: 1, deltaPx: 300, sizePx: 1474},
			layout([tile("chat", 2), tile("files", 3.85), tile("changes", 1.4)], "files"),
		],
	] satisfies Array<
		[string, PaneLayoutState, {path: number[]; index: number; deltaPx: number; sizePx: number}, PaneLayoutState]
	>)("%s", (_name, state, request, expected) => {
		expect(resizeDivider(state, request)).toEqual(expected);
	});

	it.each([
		["an unknown stack path", {path: [5], index: 0, deltaPx: 10, sizePx: 1000}],
		["a path to a tile", {path: [0], index: 0, deltaPx: 10, sizePx: 1000}],
		["a divider index past the end", {path: [], index: 1, deltaPx: 10, sizePx: 1000}],
	])("ignores %s", (_name, request) => {
		expect(resizeDivider(ONE_PANE, request)).toBe(ONE_PANE);
	});
});

describe("persistence", () => {
	it("round-trips a layout per session under one storage key", () => {
		const storage = new MemoryStorage();
		savePaneLayout("session-a", THREE_PANES, storage);
		savePaneLayout("session-b", ONE_PANE, storage);

		expect(loadPaneLayout("session-a", storage)).toEqual(THREE_PANES);
		expect(loadPaneLayout("session-b", storage)).toEqual(ONE_PANE);
		expect(JSON.parse(storage.getItem(PANE_LAYOUT_STORAGE_KEY) ?? "null")).toEqual({
			"session-a": THREE_PANES,
			"session-b": ONE_PANE,
		});
	});

	it("returns the default for an unknown session", () => {
		expect(loadPaneLayout("missing", new MemoryStorage())).toEqual(defaultPaneLayout());
	});

	it.each([
		["corrupt JSON", "{not json"],
		["an unknown field", JSON.stringify({s: {...ONE_PANE, extra: true}})],
		[
			"a duplicate tile",
			JSON.stringify({
				s: layout([tile("chat", 1), tile("files", 1), tile("files", 1)], "chat"),
			}),
		],
		["a missing chat tile", JSON.stringify({s: layout([tile("files", 1)], "files")})],
		["an expanded pane that is not open", JSON.stringify({s: {...ONE_PANE, expanded: "files"}})],
		["a non-positive flex", JSON.stringify({s: layout([tile("chat", 0)], "chat")})],
	])("falls back to the default for %s", (_name, raw) => {
		const storage = new MemoryStorage();
		storage.setItem(PANE_LAYOUT_STORAGE_KEY, raw);
		expect(loadPaneLayout("s", storage)).toEqual(defaultPaneLayout());
	});

	it("overwrites a corrupt blob on save", () => {
		const storage = new MemoryStorage();
		storage.setItem(PANE_LAYOUT_STORAGE_KEY, "{not json");
		savePaneLayout("s", ONE_PANE, storage);
		expect(JSON.parse(storage.getItem(PANE_LAYOUT_STORAGE_KEY) ?? "null")).toEqual({s: ONE_PANE});
	});

	it("is a no-op when storage throws", () => {
		const storage = new ThrowingStorage();
		expect(loadPaneLayout("s", storage)).toEqual(defaultPaneLayout());
		expect(() => savePaneLayout("s", ONE_PANE, storage)).not.toThrow();
	});

	it("is a no-op without storage", () => {
		expect(loadPaneLayout("s", null)).toEqual(defaultPaneLayout());
		expect(() => savePaneLayout("s", ONE_PANE, null)).not.toThrow();
	});
});

describe("changes scope persistence", () => {
	it("keeps the Changes scope per session beside the layout, surviving layout saves", () => {
		const storage = new MemoryStorage();
		savePaneLayout("session-a", ONE_PANE, storage);
		saveChangesScope("session-a", "commit:07bc05d", storage);
		saveChangesScope("session-b", "uncommitted", storage);
		savePaneLayout("session-a", TWO_PANES, storage);

		expect({
			scopes: [loadChangesScope("session-a", storage), loadChangesScope("session-b", storage)],
			layouts: [loadPaneLayout("session-a", storage), loadPaneLayout("session-b", storage)],
			stored: JSON.parse(storage.getItem(PANE_LAYOUT_STORAGE_KEY) ?? "null"),
		}).toEqual({
			scopes: ["commit:07bc05d", "uncommitted"],
			layouts: [TWO_PANES, defaultPaneLayout()],
			stored: {
				"session-a": {...TWO_PANES, changesScope: "commit:07bc05d"},
				"session-b": {...defaultPaneLayout(), changesScope: "uncommitted"},
			},
		});
	});

	it("defaults to the branch scope", () => {
		const storage = new MemoryStorage();
		savePaneLayout("s", ONE_PANE, storage);
		expect([
			loadChangesScope("s", storage),
			loadChangesScope("missing", storage),
			loadChangesScope("s", null),
			loadChangesScope("s", new ThrowingStorage()),
		]).toEqual(["branch", "branch", "branch", "branch"]);
	});

	it("rejects a malformed stored scope", () => {
		const storage = new MemoryStorage();
		storage.setItem(PANE_LAYOUT_STORAGE_KEY, JSON.stringify({s: {...ONE_PANE, changesScope: "commit:not-a-sha"}}));
		expect([loadChangesScope("s", storage), loadPaneLayout("s", storage)]).toEqual(["branch", defaultPaneLayout()]);
	});

	it("is a no-op when storage throws or is missing", () => {
		expect(() => saveChangesScope("s", "session", new ThrowingStorage())).not.toThrow();
		expect(() => saveChangesScope("s", "session", null)).not.toThrow();
	});
});

describe("subagent pane focus persistence", () => {
	const SUBAGENT_PANE = layout([tile("chat", 2), tile("subagents", 1)], "subagents");

	it("keeps the focused agent per session while the Subagent pane stays open", () => {
		const storage = new MemoryStorage();
		savePaneLayout("session-a", SUBAGENT_PANE, storage);
		saveSubagentPaneAgent("session-a", "agent-a1", storage);
		savePaneLayout("session-a", {...SUBAGENT_PANE, focused: "chat"}, storage);

		expect({
			focused: [loadSubagentPaneAgent("session-a", storage), loadSubagentPaneAgent("session-b", storage)],
			stored: JSON.parse(storage.getItem(PANE_LAYOUT_STORAGE_KEY) ?? "null"),
		}).toEqual({
			focused: ["agent-a1", null],
			stored: {"session-a": {...SUBAGENT_PANE, focused: "chat", subagentId: "agent-a1"}},
		});
	});

	it("forgets the focused agent when the pane closes or Back clears it", () => {
		const storage = new MemoryStorage();
		savePaneLayout("closed", SUBAGENT_PANE, storage);
		saveSubagentPaneAgent("closed", "agent-a1", storage);
		savePaneLayout("closed", ONE_PANE, storage);
		savePaneLayout("back", SUBAGENT_PANE, storage);
		saveSubagentPaneAgent("back", "agent-a1", storage);
		saveSubagentPaneAgent("back", null, storage);

		expect(JSON.parse(storage.getItem(PANE_LAYOUT_STORAGE_KEY) ?? "null")).toEqual({
			closed: ONE_PANE,
			back: SUBAGENT_PANE,
		});
	});

	it("is a no-op when storage throws or is missing", () => {
		expect([
			loadSubagentPaneAgent("s", new ThrowingStorage()),
			loadSubagentPaneAgent("s", null),
			(() => {
				saveSubagentPaneAgent("s", "agent-a1", new ThrowingStorage());
				saveSubagentPaneAgent("s", "agent-a1", null);
				return "ok";
			})(),
		]).toEqual([null, null, "ok"]);
	});
});
