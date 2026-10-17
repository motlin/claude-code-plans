import {existsSync, readdirSync} from "node:fs";
import {join} from "node:path";
import type {ActiveSessionEntry} from "../active-session-store";
import {hmrPersist} from "../hmr-persist";
import type {HerdrResult} from "./client";
import {qualifyHerdrId, splitHerdrId} from "./herdr-id";
import {herdrConfigDirectory, herdrNamedSessionSocketPath, resolveHerdrSocketPath} from "./socket-path";

/**
 * One herdr server ccp talks to: the default one, or a named session started
 * with `herdr --session <name>`. `session` is null for the default server and
 * is the id qualifier (see `herdr-id.ts`) for every other server; a socket
 * outside herdr's sessions directory is named by its own path.
 */
export interface HerdrServer {
	session: string | null;
	socketPath: string;
}

function defaultSocketPath(env: NodeJS.ProcessEnv): string {
	try {
		return resolveHerdrSocketPath(env);
	} catch {
		return "";
	}
}

function sessionsDirectory(env: NodeJS.ProcessEnv): string | null {
	try {
		return join(herdrConfigDirectory(env), "sessions");
	} catch {
		return null;
	}
}

export function herdrServerForSocketPath(socketPath: string, env: NodeJS.ProcessEnv = process.env): HerdrServer {
	if (socketPath === defaultSocketPath(env)) return {session: null, socketPath};
	const directory = sessionsDirectory(env);
	if (directory !== null) {
		const prefix = `${directory}/`;
		if (socketPath.startsWith(prefix) && socketPath.endsWith("/herdr.sock")) {
			const name = socketPath.slice(prefix.length, -"/herdr.sock".length);
			if (name !== "" && !name.includes("/")) return {session: name, socketPath};
		}
	}
	return {session: socketPath, socketPath};
}

export function herdrSocketPathForServer(session: string | null, env: NodeJS.ProcessEnv = process.env): string {
	if (session === null) return defaultSocketPath(env);
	if (session.startsWith("/")) return session;
	return herdrNamedSessionSocketPath(session, env);
}

export interface HerdrServerDiscoveryInputs {
	env: NodeJS.ProcessEnv;
	/** Directory names under herdr's `sessions/` directory. */
	sessionNames: readonly string[];
	socketExists: (socketPath: string) => boolean;
	/** `HERDR_SOCKET_PATH` values hooks reported, which can point anywhere. */
	hookSocketPaths: readonly string[];
}

/**
 * Every herdr server worth subscribing to: the default one (always, so a
 * herdr that starts later is found), each named session whose socket exists
 * (a stopped session keeps its directory but not its socket), and any other
 * socket a hook reported.
 */
export function discoverHerdrServers({
	env,
	sessionNames,
	socketExists,
	hookSocketPaths,
}: HerdrServerDiscoveryInputs): HerdrServer[] {
	const servers: HerdrServer[] = [{session: null, socketPath: defaultSocketPath(env)}];
	const seen = new Set(servers.map((server) => server.socketPath));
	const add = (socketPath: string): void => {
		if (socketPath === "" || seen.has(socketPath) || !socketExists(socketPath)) return;
		seen.add(socketPath);
		servers.push(herdrServerForSocketPath(socketPath, env));
	};
	for (const name of sessionNames.toSorted()) add(herdrNamedSessionSocketPath(name, env));
	for (const socketPath of hookSocketPaths) add(socketPath);
	return servers;
}

/** `discoverHerdrServers` against the real filesystem. */
export function discoverLiveHerdrServers(
	hookSocketPaths: readonly string[],
	env: NodeJS.ProcessEnv = process.env,
): HerdrServer[] {
	const directory = sessionsDirectory(env);
	let sessionNames: string[] = [];
	if (directory !== null) {
		try {
			sessionNames = readdirSync(directory, {withFileTypes: true})
				.filter((entry) => entry.isDirectory())
				.map((entry) => entry.name);
		} catch {
			// No sessions directory: only the default server exists.
		}
	}
	return discoverHerdrServers({env, sessionNames, socketExists: existsSync, hookSocketPaths});
}

/** The herdr session a hook-reported entry runs in, or null for the default server. */
function herdrSessionForEntry(
	entry: Pick<ActiveSessionEntry, "herdrSocketPath" | "claudeEnv">,
	env: NodeJS.ProcessEnv = process.env,
): string | null {
	if (entry.herdrSocketPath !== "") return herdrServerForSocketPath(entry.herdrSocketPath, env).session;
	const session = entry.claudeEnv["HERDR_SESSION"];
	return session && session !== "default" ? session : null;
}

/**
 * The server a new herdr launch goes to. tmux launches follow the most
 * recently active client, but herdr's API exposes no per-client activity, so
 * this uses the closest signal ccp has: the live server whose hook-reported
 * Claude session was active most recently. With none, the default server.
 */
export function chooseHerdrLaunchServer(
	entries: readonly Pick<ActiveSessionEntry, "herdrPane" | "herdrSocketPath" | "claudeEnv" | "lastActivity">[],
	liveServers: readonly HerdrServer[],
	env: NodeJS.ProcessEnv = process.env,
): HerdrServer {
	let best: {lastActivity: number; server: HerdrServer} | null = null;
	for (const entry of entries) {
		if (entry.herdrPane === "") continue;
		const session = herdrSessionForEntry(entry, env);
		const server = liveServers.find((candidate) => candidate.session === session);
		if (server === undefined) continue;
		if (best === null || entry.lastActivity > best.lastActivity) best = {lastActivity: entry.lastActivity, server};
	}
	return best?.server ?? {session: null, socketPath: defaultSocketPath(env)};
}

/** The entry's `HERDR_PANE_ID`, qualified by the server it came from. Empty when outside herdr. */
export function qualifiedEntryHerdrPane(
	entry: Pick<ActiveSessionEntry, "herdrPane" | "herdrSocketPath" | "claudeEnv">,
	env: NodeJS.ProcessEnv = process.env,
): string {
	return entry.herdrPane === "" ? "" : qualifyHerdrId(entry.herdrPane, herdrSessionForEntry(entry, env));
}

/** Request params that name a pane, tab or workspace, and so pick the server. */
const ID_PARAMS = ["pane_id", "target", "tab_id", "workspace_id", "previous_pane_id"] as const;

/**
 * Pick the socket for a request from the qualified ids in its params and
 * strip the qualifiers, so every write lands on the server that owns its pane.
 */
export function routeHerdrRequest(
	request: object,
	env: NodeJS.ProcessEnv = process.env,
): HerdrResult<{socketPath: string; request: object}> {
	const fields: Record<string, unknown> = {...request};
	const params = fields["params"];
	if (params === null || typeof params !== "object" || Array.isArray(params)) {
		return {ok: true, value: {socketPath: herdrSocketPathForServer(null, env), request}};
	}
	const rewritten: Record<string, unknown> = {...params};
	const sessions = new Set<string | null>();
	for (const key of ID_PARAMS) {
		const value = rewritten[key];
		if (typeof value !== "string") continue;
		const {id, session} = splitHerdrId(value);
		sessions.add(session);
		rewritten[key] = id;
	}
	if (sessions.size > 1) {
		return {
			ok: false,
			code: "mixed-servers",
			message: "herdr request names panes on more than one herdr server",
		};
	}
	const [session = null] = sessions;
	return {
		ok: true,
		value: {socketPath: herdrSocketPathForServer(session, env), request: {...fields, params: rewritten}},
	};
}

interface QualifiablePane {
	pane_id: string;
	workspace_id: string;
	tab_id: string;
}

interface QualifiableWorkspace {
	workspace_id: string;
	active_tab_id: string;
}

function qualifyPane<T extends QualifiablePane>(pane: T, session: string): T {
	return {
		...pane,
		pane_id: qualifyHerdrId(pane.pane_id, session),
		workspace_id: qualifyHerdrId(pane.workspace_id, session),
		tab_id: qualifyHerdrId(pane.tab_id, session),
	};
}

/** Qualify a named server's snapshot ids so its panes cannot collide with another server's. */
export function qualifyHerdrPaneState<
	S extends {workspaces: readonly QualifiableWorkspace[]; panes: readonly QualifiablePane[]},
>(state: S, session: string | null): S {
	if (session === null) return state;
	return {
		...state,
		workspaces: state.workspaces.map((workspace) => ({
			...workspace,
			workspace_id: qualifyHerdrId(workspace.workspace_id, session),
			active_tab_id: qualifyHerdrId(workspace.active_tab_id, session),
		})),
		panes: state.panes.map((pane) => qualifyPane(pane, session)),
	};
}

function isQualifiablePane(value: unknown): value is QualifiablePane {
	if (value === null || typeof value !== "object") return false;
	const fields: Record<string, unknown> = {...value};
	return (
		typeof fields["pane_id"] === "string" &&
		typeof fields["workspace_id"] === "string" &&
		typeof fields["tab_id"] === "string"
	);
}

/** Qualify the ids in one pushed herdr event's `data`. */
export function qualifyHerdrEventData(data: Record<string, unknown>, session: string | null): Record<string, unknown> {
	if (session === null) return data;
	const result: Record<string, unknown> = {...data};
	for (const key of ["pane_id", "previous_pane_id", "workspace_id", "tab_id"]) {
		const value = result[key];
		if (typeof value === "string") result[key] = qualifyHerdrId(value, session);
	}
	const pane = result["pane"];
	if (isQualifiablePane(pane)) result["pane"] = qualifyPane(pane, session);
	return result;
}

const knownServers = hmrPersist<{servers: HerdrServer[] | null}>("herdrKnownServers", () => ({servers: null}));

/** The servers the bridge manager last found live, or just the default server before it has looked. */
export function knownHerdrServers(): HerdrServer[] {
	return knownServers.servers ?? [{session: null, socketPath: defaultSocketPath(process.env)}];
}

export function setKnownHerdrServers(servers: HerdrServer[] | null): void {
	knownServers.servers = servers;
}
