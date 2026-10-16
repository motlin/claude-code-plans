import {describe, expect, it} from "vite-plus/test";
import type {ActiveSessionEntry} from "../src/lib/active-session-store";
import {createTmuxTerminalHost} from "../src/lib/terminal-host";
import {createTmuxPaneTable} from "../src/lib/tmux/pane-table";
import {
	findAncestorPane,
	getTmuxSessionPanes,
	lookupTmuxSessionPanes,
	mapSessionsToTmuxPanes,
	parseProcessParents,
	parseTmuxListPanes,
	pollTmuxSessionPanes,
	TMUX_NOT_INSTALLED,
	type TmuxListedPane,
	type TmuxSessionPane,
	type TmuxSessionPaneSources,
} from "../src/lib/tmux/session-panes";

const DEFAULT_SOCKET = "/private/tmp/tmux-501/default";

function entry(overrides: Partial<ActiveSessionEntry>): ActiveSessionEntry {
	return {
		sessionId: "session-test-1",
		state: "idle",
		cwd: "/tmp/test/alice-project",
		model: "claude-test-model",
		startedAt: 0,
		lastActivity: 0,
		claudeEnv: {},
		tmuxPane: "",
		tmuxServerSocket: "",
		herdrPane: "",
		herdrWorkspace: "",
		herdrSocketPath: "",
		lastSubagentActivityAt: null,
		backgroundTasks: [],
		...overrides,
	};
}

function line(fields: {
	paneId: string;
	panePid: number;
	socket?: string;
	session?: string;
	windowIndex?: number;
	windowName?: string;
	windowActive?: boolean;
	paneActive?: boolean;
	path?: string;
}): string {
	return [
		fields.paneId,
		String(fields.panePid),
		fields.socket ?? DEFAULT_SOCKET,
		fields.session ?? "main",
		String(fields.windowIndex ?? 0),
		fields.windowName ?? "zsh",
		fields.windowActive === true ? "1" : "0",
		fields.paneActive === true ? "1" : "0",
		fields.path ?? "/tmp/test",
	].join("\t");
}

function pane(overrides: Partial<TmuxListedPane> & Pick<TmuxListedPane, "paneId" | "panePid">): TmuxListedPane {
	return {
		socketPath: DEFAULT_SOCKET,
		sessionName: "main",
		windowIndex: 0,
		windowName: "zsh",
		windowActive: false,
		paneActive: false,
		currentPath: "/tmp/test",
		...overrides,
	};
}

describe("parseTmuxListPanes", () => {
	it("parses every field, keeps the first line per pane id, and skips malformed lines", () => {
		const stdout = [
			line({
				paneId: "%1",
				panePid: 100,
				windowIndex: 2,
				windowName: "editor tab",
				windowActive: true,
				paneActive: true,
				path: "/tmp/test/a",
			}),
			line({paneId: "%1", panePid: 100, session: "main-grouped-10", windowIndex: 2}),
			"%2\tnotapid\tx\tmain\t0\tz\t0\t0\t/",
			"",
			"garbage",
			line({paneId: "%3", panePid: 300, socket: "/tmp/test/other.sock", session: "work", windowIndex: 5}),
		].join("\n");
		expect(parseTmuxListPanes(stdout)).toStrictEqual([
			pane({
				paneId: "%1",
				panePid: 100,
				windowIndex: 2,
				windowName: "editor tab",
				windowActive: true,
				paneActive: true,
				currentPath: "/tmp/test/a",
			}),
			pane({paneId: "%3", panePid: 300, socketPath: "/tmp/test/other.sock", sessionName: "work", windowIndex: 5}),
		]);
	});
});

describe("parseProcessParents", () => {
	it("maps pid to parent pid from ps output with padding", () => {
		expect(parseProcessParents("    1     0\n  412     1\n 9001   412\nbad line\n")).toStrictEqual(
			new Map([
				[1, 0],
				[412, 1],
				[9001, 412],
			]),
		);
	});
});

describe("findAncestorPane", () => {
	const panesByPid = new Map([[200, pane({paneId: "%2", panePid: 200})]]);

	it("walks up the parents to the pane's shell", () => {
		const parents = new Map([
			[5000, 4000],
			[4000, 200],
			[200, 1],
		]);
		expect(findAncestorPane(5000, parents, panesByPid)?.paneId).toBe("%2");
	});

	it("matches a pid that is itself the pane pid", () => {
		expect(findAncestorPane(200, new Map(), panesByPid)?.paneId).toBe("%2");
	});

	it("returns null outside tmux and on a parent cycle", () => {
		expect({
			outside: findAncestorPane(
				7000,
				new Map([
					[7000, 6000],
					[6000, 1],
				]),
				panesByPid,
			),
			cycle: findAncestorPane(
				8000,
				new Map([
					[8000, 8001],
					[8001, 8000],
				]),
				panesByPid,
			),
		}).toStrictEqual({outside: null, cycle: null});
	});
});

describe("mapSessionsToTmuxPanes", () => {
	const panes = [
		pane({paneId: "%1", panePid: 100, currentPath: "/tmp/test/one"}),
		pane({paneId: "%2", panePid: 200}),
		pane({paneId: "%1", panePid: 900, socketPath: "/tmp/test/other.sock"}),
	];
	const parents = new Map([
		[1100, 100],
		[2200, 200],
		[9900, 900],
	]);

	it("links by hook env, by process tree, and by both", () => {
		const result = mapSessionsToTmuxPanes({
			entries: [
				entry({sessionId: "env-only", tmuxPane: "%2", tmuxServerSocket: DEFAULT_SOCKET}),
				entry({
					sessionId: "both",
					tmuxPane: "%1",
					tmuxServerSocket: "/tmp/test/other.sock",
					cwd: "/tmp/test/both",
				}),
			],
			registry: [
				{sessionId: "both", pid: 9900, cwd: "/tmp/test/registry-both"},
				{sessionId: "process-only", pid: 1100, cwd: "/tmp/test/proc"},
				{sessionId: "not-in-tmux", pid: 4242, cwd: "/tmp/test/none"},
			],
			panes,
			parents,
		});
		expect(result).toStrictEqual([
			{sessionId: "env-only", cwd: "/tmp/test/alice-project", pane: panes[1], via: "env"},
			{sessionId: "both", cwd: "/tmp/test/both", pane: panes[2], via: "both"},
			{sessionId: "process-only", cwd: "/tmp/test/proc", pane: panes[0], via: "process"},
		]);
	});

	it("scopes the hook pane id by its server socket", () => {
		expect(
			mapSessionsToTmuxPanes({
				entries: [entry({sessionId: "s", tmuxPane: "%2", tmuxServerSocket: "/tmp/test/other.sock"})],
				registry: [],
				panes,
				parents,
			}),
		).toStrictEqual([]);
	});

	it("prefers the process tree when the hook pane is stale, and gives each pane one session", () => {
		const result = mapSessionsToTmuxPanes({
			entries: [
				entry({sessionId: "moved", tmuxPane: "%1", tmuxServerSocket: DEFAULT_SOCKET}),
				entry({sessionId: "stale", tmuxPane: "%2", tmuxServerSocket: DEFAULT_SOCKET}),
			],
			registry: [{sessionId: "moved", pid: 2200, cwd: "/tmp/test/moved"}],
			panes,
			parents,
		});
		expect(result).toStrictEqual([
			{sessionId: "moved", cwd: "/tmp/test/alice-project", pane: panes[1], via: "process"},
		]);
	});
});

function sources(overrides: Partial<TmuxSessionPaneSources>): TmuxSessionPaneSources {
	return {
		entries: () => [],
		registry: () => [],
		listPanes: async () => Promise.resolve(""),
		processTable: async () => Promise.resolve(""),
		...overrides,
	};
}

describe("getTmuxSessionPanes", () => {
	it("reads the default server, then each other server a hook named, skipping failures", async () => {
		const calls: Array<string | null> = [];
		const result = await getTmuxSessionPanes(
			sources({
				entries: () => [
					entry({sessionId: "default", tmuxPane: "%1", tmuxServerSocket: DEFAULT_SOCKET}),
					entry({sessionId: "other", tmuxPane: "%1", tmuxServerSocket: "/tmp/test/other.sock"}),
					entry({sessionId: "dead", tmuxPane: "%1", tmuxServerSocket: "/tmp/test/dead.sock"}),
				],
				listPanes: async (socket) => {
					calls.push(socket);
					if (socket === null) return Promise.resolve(line({paneId: "%1", panePid: 100}));
					if (socket === "/tmp/test/other.sock")
						return Promise.resolve(line({paneId: "%1", panePid: 900, socket: "/tmp/test/other.sock"}));
					return Promise.reject(new Error("no server running"));
				},
			}),
		);
		expect({calls, result: result.map((link) => [link.sessionId, link.pane.socketPath, link.via])}).toStrictEqual({
			calls: [null, "/tmp/test/other.sock", "/tmp/test/dead.sock"],
			result: [
				["default", DEFAULT_SOCKET, "env"],
				["other", "/tmp/test/other.sock", "env"],
			],
		});
	});

	it("finds a hookless session from its registry pid through ps", async () => {
		const result = await getTmuxSessionPanes(
			sources({
				registry: () => [{sessionId: "hookless", pid: 3000, cwd: "/tmp/test/hookless"}],
				listPanes: async (socket) =>
					socket === null ? Promise.resolve(line({paneId: "%7", panePid: 700})) : Promise.resolve(""),
				processTable: async () => Promise.resolve("3000 2999\n2999 700\n700 1\n"),
			}),
		);
		expect(result).toStrictEqual([
			{
				sessionId: "hookless",
				cwd: "/tmp/test/hookless",
				pane: pane({paneId: "%7", panePid: 700}),
				via: "process",
			},
		]);
	});

	it("returns no links when no tmux server runs", async () => {
		const result = await getTmuxSessionPanes(
			sources({
				registry: () => [{sessionId: "s", pid: 3000, cwd: "/tmp/test"}],
				listPanes: async () => Promise.reject(new Error("no server running")),
			}),
		);
		expect(result).toStrictEqual([]);
	});
});

function missingBinary(): Error {
	return Object.assign(new Error("spawn tmux ENOENT"), {code: "ENOENT"});
}

describe("pollTmuxSessionPanes", () => {
	it("reports tmux as not installed when the tmux binary is missing", async () => {
		const missing = sources({listPanes: async () => Promise.reject(missingBinary())});

		expect({
			poll: await pollTmuxSessionPanes(missing),
			get: await getTmuxSessionPanes(missing),
		}).toStrictEqual({poll: TMUX_NOT_INSTALLED, get: []});
	});

	it("lists no panes, not a missing tmux, when tmux is installed but no server runs", async () => {
		const result = await pollTmuxSessionPanes(
			sources({listPanes: async () => Promise.reject(new Error("no server running"))}),
		);

		expect(result).toStrictEqual([]);
	});
});

describe("lookupTmuxSessionPanes", () => {
	const hooked = entry({sessionId: "hooked", tmuxPane: "%1", tmuxServerSocket: DEFAULT_SOCKET});
	const fromTmux: TmuxSessionPane = {
		sessionId: "hooked",
		cwd: "/tmp/test/alice-project",
		pane: pane({paneId: "%1", panePid: 100}),
		via: "env",
	};

	it("serves the poller's table while it is current, without running tmux", async () => {
		const table = createTmuxPaneTable();
		const fromTable = {...fromTmux, sessionId: "from-table"};
		table.hold([fromTable]);
		const calls: Array<string | null> = [];
		const result = await lookupTmuxSessionPanes(
			sources({
				entries: () => [hooked],
				listPanes: async (socket) => {
					calls.push(socket);
					return Promise.resolve(line({paneId: "%1", panePid: 100}));
				},
				paneTable: table,
			}),
		);

		expect({result, calls}).toStrictEqual({result: [fromTable], calls: []});
	});

	it("asks tmux when the table is not current", async () => {
		const result = await lookupTmuxSessionPanes(
			sources({
				entries: () => [hooked],
				listPanes: async () => Promise.resolve(line({paneId: "%1", panePid: 100})),
				paneTable: createTmuxPaneTable(),
			}),
		);

		expect(result).toStrictEqual([fromTmux]);
	});
});

describe("tmux terminal host", () => {
	it("lists session panes in the pane-link shape, labeled with the tmux host", async () => {
		const host = createTmuxTerminalHost(
			sources({
				registry: () => [{sessionId: "hookless", pid: 3000, cwd: "/tmp/test/hookless"}],
				listPanes: async (socket) =>
					socket === null
						? Promise.resolve(
								line({
									paneId: "%7",
									panePid: 700,
									session: "work",
									windowIndex: 3,
									windowName: "claude",
									windowActive: true,
									paneActive: true,
									path: "/tmp/test/hookless/src",
								}),
							)
						: Promise.resolve(""),
				processTable: async () => Promise.resolve("3000 700\n"),
			}),
		);
		expect({id: host.id, canWrite: host.canWrite, panes: await host.listPanes()}).toStrictEqual({
			id: "tmux",
			canWrite: true,
			panes: [
				{
					host: "tmux",
					paneId: "%7",
					terminalId: `tmux:${DEFAULT_SOCKET}:%7`,
					workspaceId: "work",
					tabId: "work:3",
					focused: true,
					cwd: "/tmp/test/hookless",
					foregroundCwd: "/tmp/test/hookless/src",
					agentStatus: "unknown",
					agent: "claude",
					terminalTitle: "claude",
					agentSessionId: null,
					revision: 0,
					sessionId: "hookless",
					via: "process",
				},
			],
		});
	});
});
