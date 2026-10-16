import {describe, expect, it} from "vite-plus/test";
import {getTmuxWindows, type TmuxWindow} from "../src/lib/tmux-windows";
import type {TmuxListPanesRunner, TmuxSessionPaneSources} from "../src/lib/tmux/session-panes";
import type {ActiveSessionEntry} from "../src/lib/active-session-store";

function entry(overrides: Partial<ActiveSessionEntry>): ActiveSessionEntry {
	return {
		sessionId: "s1",
		state: "working",
		cwd: "/Users/craig/projects/workflowy",
		model: "claude-sonnet-4-6",
		startedAt: 0,
		lastActivity: 0,
		claudeEnv: {},
		tmuxPane: "%1",
		tmuxServerSocket: "/tmp/tmux-501/default",
		herdrPane: "",
		herdrWorkspace: "",
		herdrSocketPath: "",
		lastSubagentActivityAt: null,
		backgroundTasks: [],
		...overrides,
	};
}

const SOCKET = "/tmp/tmux-501/default";

/** One `list-panes -a` line: pane id, pid, socket, session, window index/name/active, pane active, path. */
function paneLine(
	paneId: string,
	windowIndex: number,
	windowName: string,
	windowActive: boolean,
	socket = SOCKET,
): string {
	const pid = 1000 + Number(paneId.slice(1));
	return [paneId, pid, socket, "main", windowIndex, windowName, windowActive ? "1" : "0", "1", "/tmp"].join("\t");
}

function sources(entries: ActiveSessionEntry[], listPanes: TmuxListPanesRunner): TmuxSessionPaneSources {
	return {
		entries: () => entries,
		registry: () => [],
		listPanes,
		processTable: async () => Promise.resolve(""),
	};
}

describe("getTmuxWindows", () => {
	it("joins store entries to tmux panes by pane id", async () => {
		const entries = [
			entry({sessionId: "sA", tmuxPane: "%1"}),
			entry({sessionId: "sB", tmuxPane: "%2", cwd: "/Users/craig/projects/foo"}),
		];
		const runTmux = async () =>
			Promise.resolve(
				[
					paneLine("%1", 0, "editor", true),
					paneLine("%2", 2, "build", false),
					paneLine("%9", 5, "other", false),
				].join("\n"),
			);

		const windows = await getTmuxWindows(sources(entries, runTmux));
		const expected: TmuxWindow[] = [
			{
				sessionId: "sA",
				projectName: "workflowy",
				windowIndex: 0,
				windowName: "editor",
				windowActive: true,
				tmuxPane: "%1",
				socket: SOCKET,
			},
			{
				sessionId: "sB",
				projectName: "foo",
				windowIndex: 2,
				windowName: "build",
				windowActive: false,
				tmuxPane: "%2",
				socket: SOCKET,
			},
		];
		expect(windows).toStrictEqual(expected);
	});

	it("sorts by window index", async () => {
		const entries = [entry({sessionId: "sA", tmuxPane: "%1"}), entry({sessionId: "sB", tmuxPane: "%2"})];
		const runTmux = async () =>
			Promise.resolve([paneLine("%1", 7, "a", false), paneLine("%2", 3, "b", false)].join("\n"));
		const windows = await getTmuxWindows(sources(entries, runTmux));
		expect(windows.map((w) => w.windowIndex)).toStrictEqual([3, 7]);
	});

	it("ignores entries without a pane, and matches a socketless hook pane on any server", async () => {
		const entries = [
			entry({sessionId: "sA", tmuxPane: "", tmuxServerSocket: ""}),
			entry({sessionId: "sB", tmuxPane: "%2", tmuxServerSocket: ""}),
			entry({sessionId: "sC", tmuxPane: "%3"}),
		];
		const runTmux = async () =>
			Promise.resolve([paneLine("%2", 0, "b", false), paneLine("%3", 1, "c", true)].join("\n"));
		const windows = await getTmuxWindows(sources(entries, runTmux));
		expect(windows.map((w) => w.sessionId)).toStrictEqual(["sB", "sC"]);
	});

	it("emits only matched panes", async () => {
		const entries = [entry({sessionId: "sA", tmuxPane: "%missing"})];
		const runTmux = async () => Promise.resolve(paneLine("%1", 0, "x", true));
		const windows = await getTmuxWindows(sources(entries, runTmux));
		expect(windows).toStrictEqual([]);
	});

	it("collapses multiple entries mapping to the same pane", async () => {
		const entries = [entry({sessionId: "sA", tmuxPane: "%1"}), entry({sessionId: "sB", tmuxPane: "%1"})];
		const runTmux = async () => Promise.resolve(paneLine("%1", 0, "x", true));
		const windows = await getTmuxWindows(sources(entries, runTmux));
		expect(windows.map((w) => w.sessionId)).toStrictEqual(["sA"]);
	});

	it("reads each hook socket's server and drops only a failing server's windows", async () => {
		const entries = [
			entry({sessionId: "sA", tmuxPane: "%1", tmuxServerSocket: "/tmp/sock-a"}),
			entry({sessionId: "sB", tmuxPane: "%1", tmuxServerSocket: "/tmp/sock-b"}),
		];
		const runTmux = async (socket: string | null) => {
			if (socket === "/tmp/sock-b") return Promise.resolve(paneLine("%1", 0, "x", true, "/tmp/sock-b"));
			return Promise.reject(new Error("no server running"));
		};
		const windows = await getTmuxWindows(sources(entries, runTmux));
		expect(windows.map((w) => [w.sessionId, w.socket])).toStrictEqual([["sB", "/tmp/sock-b"]]);
	});

	it("returns [] when there are no tmux entries", async () => {
		const windows = await getTmuxWindows(sources([], async () => Promise.resolve("")));
		expect(windows).toStrictEqual([]);
	});
});
