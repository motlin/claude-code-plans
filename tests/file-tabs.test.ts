import {describe, expect, it} from "vite-plus/test";

import {EMPTY_FILE_TABS, type FileTabsAction, type FileTabsState, fileTabsReducer} from "../src/lib/file-tabs";
import {
	defaultPaneLayout,
	loadFileTabs,
	openPane,
	PANE_LAYOUT_STORAGE_KEY,
	saveFileTabs,
	savePaneLayout,
} from "../src/lib/pane-layout";
import {installLocalStorage} from "./fake-storage";

function run(actions: readonly FileTabsAction[], previewTabs = true): FileTabsState {
	return actions.reduce((state, action) => fileTabsReducer(state, action, {previewTabs}), EMPTY_FILE_TABS);
}

/** Renders tabs as upstream's observation notes them: preview tabs starred, the active one bracketed. */
function strip(state: FileTabsState): string[] {
	return state.tabs.map((tab) => {
		const label = tab.preview ? `${tab.path}*` : tab.path;
		return tab.path === state.active ? `[${label}]` : label;
	});
}

const open = (path: string, pin = false): FileTabsAction => ({type: "open", path, pin});

describe("fileTabsReducer", () => {
	it.each<[string, FileTabsAction[], string[]]>([
		["a single click opens a preview tab", [open("a")], ["[a*]"]],
		["a double-click opens a pinned tab", [open("a", true)], ["[a]"]],
		["a second click replaces the preview tab", [open("a"), open("b")], ["[b*]"]],
		[
			"the observed upstream sequence: dbl-click, click, transcript link",
			[open("deleted.txt", true), open("del-in-origin.txt"), open("config.toml")],
			["deleted.txt", "[config.toml*]"],
		],
		[
			"the preview tab is replaced in place",
			[open("a"), open("b", true), {type: "reveal", path: "a"}, open("c")],
			["[c*]", "b"],
		],
		[
			"a new tab opens right after the active one",
			[open("a", true), open("b", true), {type: "reveal", path: "a"}, open("c", true)],
			["a", "[c]", "b"],
		],
		["opening a pinned file again only activates it", [open("a", true), open("b"), open("a")], ["[a]", "b*"]],
		["double-clicking a preview tab's file pins it", [open("a"), open("a", true)], ["[a]"]],
		["pin makes the preview tab upright", [open("a"), {type: "pin", path: "a"}], ["[a]"]],
		[
			"closing the active tab activates its right neighbour",
			[
				open("a", true),
				open("b", true),
				open("c", true),
				{type: "reveal", path: "b"},
				{type: "close", path: "b"},
			],
			["a", "[c]"],
		],
		[
			"closing the last active tab activates its left neighbour",
			[open("a", true), open("b", true), {type: "close", path: "b"}],
			["[a]"],
		],
		[
			"closing an inactive tab keeps the active one",
			[open("a", true), open("b", true), {type: "close", path: "a"}],
			["[b]"],
		],
		["closing the only tab leaves none", [open("a"), {type: "close", path: "a"}], []],
		[
			"close others keeps and activates the target",
			[open("a", true), open("b", true), open("c"), {type: "closeOthers", path: "b"}],
			["[b]"],
		],
		["close all empties the strip", [open("a", true), open("b"), {type: "closeAll"}], []],
		[
			"move right swaps with the next tab",
			[open("a", true), open("b", true), {type: "move", path: "a", delta: 1}],
			["[b]", "a"],
		],
		[
			"move left past the start is a no-op",
			[open("a", true), open("b", true), {type: "move", path: "a", delta: -1}],
			["a", "[b]"],
		],
		[
			"move right past the end is a no-op",
			[open("a", true), open("b", true), {type: "move", path: "b", delta: 1}],
			["a", "[b]"],
		],
		[
			"reveal activates an open tab without pinning it",
			[open("a", true), open("b"), {type: "reveal", path: "a"}],
			["[a]", "b*"],
		],
		[
			"actions on a file that is not open are no-ops",
			[
				open("a"),
				{type: "pin", path: "x"},
				{type: "close", path: "x"},
				{type: "closeOthers", path: "x"},
				{type: "move", path: "x", delta: 1},
				{type: "reveal", path: "x"},
			],
			["[a*]"],
		],
	])("%s", (_name, actions, expected) => {
		expect(strip(run(actions))).toStrictEqual(expected);
	});

	it("pins every open when the Preview tabs setting is off", () => {
		expect(
			strip(run([open("deleted.txt", true), open("del-in-origin.txt"), open("config.toml")], false)),
		).toStrictEqual(["deleted.txt", "del-in-origin.txt", "[config.toml]"]);
	});

	it("returns the same state for a no-op", () => {
		const state = run([open("a", true)]);
		expect(fileTabsReducer(state, open("a"), {previewTabs: true})).toBe(state);
	});
});

describe("file tab persistence", () => {
	const tabs: FileTabsState = {
		tabs: [
			{path: "/w/a.ts", preview: false},
			{path: "/w/b.ts", preview: true},
		],
		active: "/w/b.ts",
	};

	it("round-trips per session in the pane layout store", () => {
		const storage = installLocalStorage();
		saveFileTabs("s1", tabs, storage);
		expect({
			s1: loadFileTabs("s1", storage),
			s2: loadFileTabs("s2", storage),
		}).toStrictEqual({s1: tabs, s2: EMPTY_FILE_TABS});
	});

	it("keeps the tabs while the Files pane stays open", () => {
		const storage = installLocalStorage();
		saveFileTabs("s1", tabs, storage);
		savePaneLayout("s1", openPane(defaultPaneLayout(), "files"), storage);
		expect(loadFileTabs("s1", storage)).toStrictEqual(tabs);
	});

	it("discards the session's tabs when the Files pane closes", () => {
		const storage = installLocalStorage();
		savePaneLayout("s1", openPane(defaultPaneLayout(), "files"), storage);
		saveFileTabs("s1", tabs, storage);
		savePaneLayout("s1", defaultPaneLayout(), storage);
		expect(loadFileTabs("s1", storage)).toStrictEqual(EMPTY_FILE_TABS);
	});

	it.each([
		["an active tab that is not open", {tabs: [{path: "a", preview: false}], active: "b"}],
		[
			"duplicate tabs",
			{
				tabs: [
					{path: "a", preview: false},
					{path: "a", preview: true},
				],
				active: "a",
			},
		],
		[
			"two preview tabs",
			{
				tabs: [
					{path: "a", preview: true},
					{path: "b", preview: true},
				],
				active: "a",
			},
		],
	])("rejects a stored entry with %s", (_name, fileTabs) => {
		const storage = installLocalStorage();
		storage.setItem(PANE_LAYOUT_STORAGE_KEY, JSON.stringify({s1: {...defaultPaneLayout(), fileTabs}}));
		expect(loadFileTabs("s1", storage)).toStrictEqual(EMPTY_FILE_TABS);
	});
});
