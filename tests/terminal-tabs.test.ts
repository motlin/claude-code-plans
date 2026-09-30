import {describe, expect, it} from "vite-plus/test";

import {
	closeGuard,
	EMPTY_TERMINAL_TABS,
	reduceTerminalTabs,
	restoreTerminalTabs,
	serializeTerminalTabs,
	type TerminalTabsAction,
	type TerminalTabsState,
	terminalTabsStorageKey,
} from "../src/lib/terminal-tabs";

function run(actions: readonly TerminalTabsAction[], start = EMPTY_TERMINAL_TABS) {
	return actions.reduce<TerminalTabsState>(reduceTerminalTabs, start);
}

const THREE_SHELLS = run([
	{type: "add", ptyKey: "pty-alice-1"},
	{type: "add", ptyKey: "pty-alice-2"},
	{type: "add", ptyKey: "pty-alice-3"},
]);

describe("reduceTerminalTabs", () => {
	it("adds numbered Shell tabs and selects the new one", () => {
		expect(THREE_SHELLS).toStrictEqual({
			tabs: [
				{id: "shell-1", ptyKey: "pty-alice-1", title: "Shell", closing: false},
				{id: "shell-2", ptyKey: "pty-alice-2", title: "Shell 2", closing: false},
				{id: "shell-3", ptyKey: "pty-alice-3", title: "Shell 3", closing: false},
			],
			active: "shell-3",
			opened: 3,
		});
	});

	it("renames a tab to its trimmed title and ignores a blank name", () => {
		const renamed = run(
			[
				{type: "rename", id: "shell-2", title: "  dev server  "},
				{type: "rename", id: "shell-3", title: "   "},
			],
			THREE_SHELLS,
		);

		expect(renamed.tabs.map((tab) => tab.title)).toStrictEqual(["Shell", "dev server", "Shell 3"]);
	});

	it("marks tabs closing, then removes them and selects the left neighbour", () => {
		const closing = run([{type: "request-close", ids: ["shell-3"]}], THREE_SHELLS);
		const removed = run([{type: "remove", id: "shell-3"}], closing);

		expect({
			closing: closing.tabs.map((tab) => [tab.id, tab.closing]),
			removed: {ids: removed.tabs.map((tab) => tab.id), active: removed.active},
			first: run([{type: "remove", id: "shell-1"}], {
				...THREE_SHELLS,
				active: "shell-1",
			}).active,
			unrelated: run([{type: "remove", id: "shell-1"}], THREE_SHELLS).active,
		}).toStrictEqual({
			closing: [
				["shell-1", false],
				["shell-2", false],
				["shell-3", true],
			],
			removed: {ids: ["shell-1", "shell-2"], active: "shell-2"},
			first: null,
			unrelated: "shell-3",
		});
	});

	it("closes the other terminals and selects the one kept, Claude included", () => {
		const fromShell = run([{type: "close-others", id: "shell-2"}], THREE_SHELLS);
		const fromClaude = run([{type: "close-others", id: "claude"}], THREE_SHELLS);

		expect({
			fromShell: {
				closing: fromShell.tabs.map((tab) => [tab.id, tab.closing]),
				active: fromShell.active,
			},
			fromClaude: {
				closing: fromClaude.tabs.map((tab) => tab.closing),
				active: fromClaude.active,
			},
		}).toStrictEqual({
			fromShell: {
				closing: [
					["shell-1", true],
					["shell-2", false],
					["shell-3", true],
				],
				active: "shell-2",
			},
			fromClaude: {closing: [true, true, true], active: "claude"},
		});
	});

	it("moves a tab one place left or right and stops at either end", () => {
		const ids = (state: TerminalTabsState) => state.tabs.map((tab) => tab.id);

		expect([
			ids(run([{type: "move", id: "shell-3", delta: -1}], THREE_SHELLS)),
			ids(run([{type: "move", id: "shell-1", delta: 1}], THREE_SHELLS)),
			ids(run([{type: "move", id: "shell-1", delta: -1}], THREE_SHELLS)),
			ids(run([{type: "move", id: "shell-3", delta: 1}], THREE_SHELLS)),
			ids(run([{type: "move", id: "claude", delta: 1}], THREE_SHELLS)),
		]).toStrictEqual([
			["shell-1", "shell-3", "shell-2"],
			["shell-2", "shell-1", "shell-3"],
			["shell-1", "shell-2", "shell-3"],
			["shell-1", "shell-2", "shell-3"],
			["shell-1", "shell-2", "shell-3"],
		]);
	});

	it("restarts a tab on a new shell without changing its id, title or place", () => {
		const restarted = run(
			[
				{type: "rename", id: "shell-2", title: "tests"},
				{type: "restart", id: "shell-2", ptyKey: "pty-alice-9"},
			],
			THREE_SHELLS,
		);

		expect(restarted.tabs[1]).toStrictEqual({
			id: "shell-2",
			ptyKey: "pty-alice-9",
			title: "tests",
			closing: false,
		});
	});

	it("selects a tab", () => {
		expect(run([{type: "select", id: "claude"}], THREE_SHELLS).active).toBe("claude");
	});
});

describe("closeGuard", () => {
	const [first, second, third] = THREE_SHELLS.tabs;
	if (!first || !second || !third) throw new Error("fixture needs three tabs");

	it("closes straight away when nothing is running", () => {
		expect([
			closeGuard("close", [first], new Set()),
			closeGuard("close-others", [first, third], new Set(["pty-bob-1"])),
		]).toStrictEqual([{confirm: false}, {confirm: false}]);
	});

	it("asks before closing a terminal with a command still running", () => {
		expect(closeGuard("close", [second], new Set(["pty-alice-2"]))).toStrictEqual({
			confirm: true,
			title: "Close terminal?",
			body: "A command is still running in Shell 2. Closing the terminal stops it.",
			confirmLabel: "Close terminal",
		});
	});

	it("names one busy terminal and counts several when closing the others", () => {
		expect([
			closeGuard("close-others", [first, third], new Set(["pty-alice-3"])),
			closeGuard("close-others", [first, third], new Set(["pty-alice-1", "pty-alice-3"])),
		]).toStrictEqual([
			{
				confirm: true,
				title: "Close other terminals?",
				body: "A command is still running in Shell 3. Closing the other terminals stops it.",
				confirmLabel: "Close other terminals",
			},
			{
				confirm: true,
				title: "Close other terminals?",
				body: "Commands are still running in 2 terminals. Closing the other terminals stops them.",
				confirmLabel: "Close other terminals",
			},
		]);
	});
});

describe("terminal tab persistence", () => {
	it("keys the tab list per session", () => {
		expect(terminalTabsStorageKey("alice-session")).toBe("ccp-terminal-tabs:alice-session");
	});

	it("round-trips the tab list, dropping tabs that were closing", () => {
		const state = run(
			[
				{type: "rename", id: "shell-1", title: "logs"},
				{type: "request-close", ids: ["shell-3"]},
				{type: "select", id: "shell-2"},
			],
			THREE_SHELLS,
		);

		expect(restoreTerminalTabs(serializeTerminalTabs(state))).toStrictEqual({
			tabs: [
				{id: "shell-1", ptyKey: "pty-alice-1", title: "logs", closing: false},
				{id: "shell-2", ptyKey: "pty-alice-2", title: "Shell 2", closing: false},
			],
			active: "shell-2",
			opened: 3,
		});
	});

	it("falls back to no tabs for missing or malformed storage", () => {
		expect([
			restoreTerminalTabs(null),
			restoreTerminalTabs("not json"),
			restoreTerminalTabs(JSON.stringify({tabs: [{id: "shell-1"}], active: null, opened: 1})),
			restoreTerminalTabs(JSON.stringify({tabs: [], active: null, opened: 0, extra: true})),
		]).toStrictEqual([EMPTY_TERMINAL_TABS, EMPTY_TERMINAL_TABS, EMPTY_TERMINAL_TABS, EMPTY_TERMINAL_TABS]);
	});
});
