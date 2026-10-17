import {describe, expect, it} from "vite-plus/test";
import type {ActiveSessionEntry} from "../src/lib/active-session-store";
import type {HerdrPaneState} from "../src/lib/herdr/pane-table";
import {getSessionTerminalHosts, type SessionTerminalHostSources} from "../src/lib/session-terminal-hosts";
import type {TmuxSessionPane} from "../src/lib/tmux/session-panes";

function herdrPane(paneId: string, workspaceId: string, sessionId: string | null): HerdrPaneState["panes"][number] {
	return {
		pane_id: paneId,
		terminal_id: `terminal-${paneId}`,
		workspace_id: workspaceId,
		tab_id: `${workspaceId}:t1`,
		focused: false,
		agent_status: "idle",
		revision: 1,
		...(sessionId === null ? {} : {agent_session: {source: "test", agent: "claude", kind: "id", value: sessionId}}),
	};
}

function tmuxPane(sessionId: string, sessionName: string): TmuxSessionPane {
	return {
		sessionId,
		cwd: "/repo",
		via: "env",
		pane: {
			paneId: "%7",
			panePid: 700,
			socketPath: "/tmp/tmux-501/default",
			sessionName,
			windowIndex: 0,
			windowName: "claude",
			windowActive: true,
			paneActive: true,
			currentPath: "/repo",
		},
	};
}

function sources(overrides: Partial<SessionTerminalHostSources>): SessionTerminalHostSources {
	return {
		herdr: {current: () => null},
		tmux: {current: () => null},
		entries: () => [],
		indexedSessionFilter: (ids) => new Set(ids),
		...overrides,
	};
}

describe("getSessionTerminalHosts", () => {
	it("labels each session by the herdr or tmux pane it runs in, from the in-memory pane tables", () => {
		const herdr: HerdrPaneState = {
			workspaces: [],
			panes: [
				herdrPane("wE:p2", "wE", "session-herdr"),
				herdrPane("wM:p1@later", "wM@later", "session-named"),
				herdrPane("wX:p9", "wX", null),
			],
		};
		const viaEnv = {sessionId: "session-env", herdrPane: "wE:p3"} as ActiveSessionEntry;
		const hosts = getSessionTerminalHosts(
			sources({
				herdr: {current: () => ({...herdr, panes: [...herdr.panes, herdrPane("wE:p3", "wE", null)]})},
				tmux: {current: () => [tmuxPane("session-tmux", "work")]},
				entries: () => [{...viaEnv, herdrSocketPath: "", claudeEnv: {}}],
			}),
		);

		expect(Object.fromEntries(hosts)).toStrictEqual({
			"session-herdr": "herdr",
			"session-named": "herdr · later",
			"session-env": "herdr",
			"session-tmux": "tmux · work",
		});
	});

	it("labels nothing while neither pane table is current, without asking herdr or tmux", () => {
		expect(Object.fromEntries(getSessionTerminalHosts(sources({})))).toStrictEqual({});
	});
});
