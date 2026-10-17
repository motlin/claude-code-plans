import {describe, expect, it} from "vite-plus/test";
import {qualifyHerdrId, splitHerdrId} from "../src/lib/herdr/herdr-id";
import {
	chooseHerdrLaunchServer,
	discoverHerdrServers,
	herdrServerForSocketPath,
	herdrSocketPathForServer,
	knownOrDiscoveredHerdrServers,
	qualifyHerdrEventData,
	qualifyHerdrPaneState,
	routeHerdrRequest,
	setKnownHerdrServers,
} from "../src/lib/herdr/servers";

const ENV = {HOME: "/tmp/test/home"};
const DEFAULT_SOCKET = "/tmp/test/home/.config/herdr/herdr.sock";
const LATER_SOCKET = "/tmp/test/home/.config/herdr/sessions/later/herdr.sock";

describe("herdr ids", () => {
	it("keeps default-server ids bare and suffixes named-server ids with their session", () => {
		expect([qualifyHerdrId("wM:p1", null), qualifyHerdrId("wM:p1", "later")]).toStrictEqual([
			"wM:p1",
			"wM:p1@later",
		]);
	});

	it("splits a qualified id back into the raw id and its session", () => {
		expect([splitHerdrId("wM:p1"), splitHerdrId("wM:p1@later")]).toStrictEqual([
			{id: "wM:p1", session: null},
			{id: "wM:p1", session: "later"},
		]);
	});
});

describe("discoverHerdrServers", () => {
	it("finds the default socket, every named session with a socket, and hook-reported sockets", () => {
		const existing = new Set([DEFAULT_SOCKET, LATER_SOCKET, "/tmp/test/custom/herdr.sock"]);
		expect(
			discoverHerdrServers({
				env: ENV,
				sessionNames: ["later", "pane-order-demo"],
				socketExists: (path) => existing.has(path),
				hookSocketPaths: [LATER_SOCKET, "/tmp/test/custom/herdr.sock", "/tmp/test/gone/herdr.sock", ""],
			}),
		).toStrictEqual([
			{session: null, socketPath: DEFAULT_SOCKET},
			{session: "later", socketPath: LATER_SOCKET},
			{session: "/tmp/test/custom/herdr.sock", socketPath: "/tmp/test/custom/herdr.sock"},
		]);
	});

	it("keeps the default server even before its socket exists", () => {
		expect(
			discoverHerdrServers({env: ENV, sessionNames: [], socketExists: () => false, hookSocketPaths: []}),
		).toStrictEqual([{session: null, socketPath: DEFAULT_SOCKET}]);
	});
});

describe("herdr server names", () => {
	it("names a socket by its session directory, the default socket by null, and anything else by its path", () => {
		expect([
			herdrServerForSocketPath(DEFAULT_SOCKET, ENV),
			herdrServerForSocketPath(LATER_SOCKET, ENV),
			herdrServerForSocketPath("/tmp/test/custom/herdr.sock", ENV),
		]).toStrictEqual([
			{session: null, socketPath: DEFAULT_SOCKET},
			{session: "later", socketPath: LATER_SOCKET},
			{session: "/tmp/test/custom/herdr.sock", socketPath: "/tmp/test/custom/herdr.sock"},
		]);
	});

	it("maps a session name back to its socket", () => {
		expect([
			herdrSocketPathForServer(null, ENV),
			herdrSocketPathForServer("later", ENV),
			herdrSocketPathForServer("/tmp/test/custom/herdr.sock", ENV),
		]).toStrictEqual([DEFAULT_SOCKET, LATER_SOCKET, "/tmp/test/custom/herdr.sock"]);
	});
});

describe("routeHerdrRequest", () => {
	it("sends a request naming a qualified pane to that pane's socket with the raw id", () => {
		expect(
			routeHerdrRequest(
				{id: "ccp:q", method: "pane.send_text", params: {pane_id: "wM:p1@later", text: "a@b"}},
				ENV,
			),
		).toStrictEqual({
			ok: true,
			value: {
				socketPath: LATER_SOCKET,
				request: {id: "ccp:q", method: "pane.send_text", params: {pane_id: "wM:p1", text: "a@b"}},
			},
		});
	});

	it("rewrites agent targets too and leaves default-server requests alone", () => {
		expect([
			routeHerdrRequest(
				{id: "k", method: "agent.send_keys", params: {target: "wM:p1@later", keys: ["Enter"]}},
				ENV,
			),
			routeHerdrRequest({id: "k", method: "agent.send_keys", params: {target: "w1:p1", keys: ["Enter"]}}, ENV),
		]).toStrictEqual([
			{
				ok: true,
				value: {
					socketPath: LATER_SOCKET,
					request: {id: "k", method: "agent.send_keys", params: {target: "wM:p1", keys: ["Enter"]}},
				},
			},
			{
				ok: true,
				value: {
					socketPath: DEFAULT_SOCKET,
					request: {id: "k", method: "agent.send_keys", params: {target: "w1:p1", keys: ["Enter"]}},
				},
			},
		]);
	});

	it("refuses a request whose ids name two different servers", () => {
		expect(
			routeHerdrRequest(
				{id: "m", method: "pane.move", params: {pane_id: "w1:p1@later", workspace_id: "w2"}},
				ENV,
			),
		).toStrictEqual({
			ok: false,
			code: "mixed-servers",
			message: "herdr request names panes on more than one herdr server",
		});
	});
});

describe("qualifying named-server state", () => {
	const pane = {
		pane_id: "wM:p1",
		terminal_id: "term_100",
		workspace_id: "wM",
		tab_id: "wM:t1",
		focused: true,
		agent_status: "blocked",
		revision: 3,
	};
	const workspace = {
		workspace_id: "wM",
		number: 1,
		label: "eclipse-collections",
		focused: true,
		pane_count: 1,
		tab_count: 1,
		active_tab_id: "wM:t1",
		agent_status: "blocked",
	};

	it("suffixes pane, tab and workspace ids but keeps globally unique terminal ids", () => {
		expect(qualifyHerdrPaneState({workspaces: [workspace], panes: [pane]}, "later")).toStrictEqual({
			workspaces: [{...workspace, workspace_id: "wM@later", active_tab_id: "wM:t1@later"}],
			panes: [{...pane, pane_id: "wM:p1@later", workspace_id: "wM@later", tab_id: "wM:t1@later"}],
		});
	});

	it("leaves default-server state untouched", () => {
		const state = {workspaces: [workspace], panes: [pane]};
		expect(qualifyHerdrPaneState(state, null)).toBe(state);
	});

	it("suffixes the ids in pushed event data", () => {
		expect([
			qualifyHerdrEventData({pane_id: "wM:p1", agent_status: "idle"}, "later"),
			qualifyHerdrEventData({previous_pane_id: "wM:p1", pane}, "later"),
		]).toStrictEqual([
			{pane_id: "wM:p1@later", agent_status: "idle"},
			{
				previous_pane_id: "wM:p1@later",
				pane: {...pane, pane_id: "wM:p1@later", workspace_id: "wM@later", tab_id: "wM:t1@later"},
			},
		]);
	});
});

describe("chooseHerdrLaunchServer", () => {
	const LIVE = [
		{session: null, socketPath: DEFAULT_SOCKET},
		{session: "later", socketPath: LATER_SOCKET},
	];
	const entry = (lastActivity: number, herdrSocketPath: string, herdrPane = "w1:p1") => ({
		lastActivity,
		herdrPane,
		herdrSocketPath,
		claudeEnv: {},
	});

	it("picks the live server of the most recently active herdr session", () => {
		expect(
			chooseHerdrLaunchServer(
				[entry(100, DEFAULT_SOCKET), entry(300, LATER_SOCKET), entry(500, DEFAULT_SOCKET, "")],
				LIVE,
				ENV,
			),
		).toStrictEqual({session: "later", socketPath: LATER_SOCKET});
	});

	it("names the server from HERDR_SESSION when the hook reported no socket", () => {
		expect(
			chooseHerdrLaunchServer(
				[{lastActivity: 1, herdrPane: "w1:p1", herdrSocketPath: "", claudeEnv: {HERDR_SESSION: "later"}}],
				LIVE,
				ENV,
			),
		).toStrictEqual({session: "later", socketPath: LATER_SOCKET});
	});

	it("skips sessions on servers that are no longer live and falls back to the default server", () => {
		expect([
			chooseHerdrLaunchServer([entry(900, "/tmp/test/gone/herdr.sock"), entry(100, DEFAULT_SOCKET)], LIVE, ENV),
			chooseHerdrLaunchServer([entry(900, "/tmp/test/gone/herdr.sock")], LIVE, ENV),
			chooseHerdrLaunchServer([], [], ENV),
		]).toStrictEqual([
			{session: null, socketPath: DEFAULT_SOCKET},
			{session: null, socketPath: DEFAULT_SOCKET},
			{session: null, socketPath: DEFAULT_SOCKET},
		]);
	});
});

describe("knownOrDiscoveredHerdrServers", () => {
	const discovered = [
		{session: null, socketPath: DEFAULT_SOCKET},
		{session: "later", socketPath: LATER_SOCKET},
	];

	it("discovers named sessions on disk before the event bridge has registered any server", () => {
		setKnownHerdrServers(null);
		expect(knownOrDiscoveredHerdrServers(() => discovered)).toStrictEqual(discovered);
	});

	it("uses the bridge's registry once it has one, without touching the disk", () => {
		const registered = [{session: "pane-order-demo", socketPath: "/tmp/test/demo/herdr.sock"}];
		setKnownHerdrServers(registered);
		try {
			expect(
				knownOrDiscoveredHerdrServers(() => {
					throw new Error("discovery should not run");
				}),
			).toStrictEqual(registered);
		} finally {
			setKnownHerdrServers(null);
		}
	});
});
