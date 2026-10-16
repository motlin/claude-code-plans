import {execFile} from "node:child_process";
import {getActiveSessionEntries, type ActiveSessionEntry} from "../active-session-store";
import {getRegistrySessionStates, type RegistrySessionState} from "../session-registry-store";

/** One pane from `tmux list-panes -a`, with the server socket it came from. */
export interface TmuxListedPane {
	paneId: string;
	panePid: number;
	socketPath: string;
	sessionName: string;
	windowIndex: number;
	windowName: string;
	windowActive: boolean;
	paneActive: boolean;
	currentPath: string;
}

/** How a session was tied to its pane: the hook's `TMUX_PANE`, its process tree, or both. */
export type TmuxPaneVia = "env" | "process" | "both";

/** A live Claude session and the tmux pane it runs in. */
export interface TmuxSessionPane {
	sessionId: string;
	/** The session's cwd from the hook or the CLI registry, else the pane's current path. */
	cwd: string;
	pane: TmuxListedPane;
	via: TmuxPaneVia;
}

/**
 * `list-panes -a` format. Tab-separated so window names with spaces survive the
 * split; `#{socket_path}` lets hook-reported sockets be matched to a server.
 */
const TMUX_LIST_PANES_FORMAT = [
	"#{pane_id}",
	"#{pane_pid}",
	"#{socket_path}",
	"#{session_name}",
	"#{window_index}",
	"#{window_name}",
	"#{window_active}",
	"#{pane_active}",
	"#{pane_current_path}",
].join("\t");

/**
 * Parse `list-panes -a` output. Grouped tmux sessions (`main`,
 * `main-grouped-10`, …) repeat a pane under each session name; the first line
 * for a pane id wins. Malformed lines are skipped.
 */
export function parseTmuxListPanes(stdout: string): TmuxListedPane[] {
	const byPaneId = new Map<string, TmuxListedPane>();
	for (const line of stdout.split("\n")) {
		if (line.trim() === "") continue;
		const [
			paneId,
			panePidRaw,
			socketPath,
			sessionName,
			windowIndexRaw,
			windowName,
			windowActive,
			paneActive,
			path,
		] = line.split("\t");
		if (paneId === undefined || !paneId.startsWith("%") || byPaneId.has(paneId)) continue;
		const panePid = Number.parseInt(panePidRaw ?? "", 10);
		const windowIndex = Number.parseInt(windowIndexRaw ?? "", 10);
		if (Number.isNaN(panePid) || Number.isNaN(windowIndex)) continue;
		byPaneId.set(paneId, {
			paneId,
			panePid,
			socketPath: socketPath ?? "",
			sessionName: sessionName ?? "",
			windowIndex,
			windowName: windowName ?? "",
			windowActive: windowActive === "1",
			paneActive: paneActive === "1",
			currentPath: path ?? "",
		});
	}
	return [...byPaneId.values()];
}

/** Parse `ps -A -o pid=,ppid=` output into pid → parent pid. */
export function parseProcessParents(stdout: string): Map<number, number> {
	const parents = new Map<number, number>();
	for (const line of stdout.split("\n")) {
		const [, pid, ppid] = /^\s*(\d+)\s+(\d+)\s*$/.exec(line) ?? [];
		if (pid !== undefined && ppid !== undefined) parents.set(Number(pid), Number(ppid));
	}
	return parents;
}

/**
 * Walk `pid` and its ancestors until one is a pane's `#{pane_pid}` (the shell
 * or command tmux started in the pane). Stops at the root or on a cycle.
 */
export function findAncestorPane<T extends {panePid: number}>(
	pid: number,
	parents: ReadonlyMap<number, number>,
	panesByPid: ReadonlyMap<number, T>,
): T | null {
	const seen = new Set<number>();
	let current: number | undefined = pid;
	while (current !== undefined && current > 1 && !seen.has(current)) {
		const pane = panesByPid.get(current);
		if (pane !== undefined) return pane;
		seen.add(current);
		current = parents.get(current);
	}
	return null;
}

export interface TmuxSessionPaneInputs {
	/** Hook-reported sessions; those with `tmuxPane` link by environment. */
	entries: readonly ActiveSessionEntry[];
	/** Live CLI processes from `~/.claude/sessions/*.json`; linked by process tree. */
	registry: readonly Pick<RegistrySessionState, "sessionId" | "pid" | "cwd">[];
	panes: readonly TmuxListedPane[];
	parents: ReadonlyMap<number, number>;
}

/**
 * Tie sessions to tmux panes by two independent links: the hook's `TMUX_PANE`
 * (scoped by its server socket when the hook sent one) and the session pid's
 * ancestry. A session gets at most one pane; when the links disagree the
 * process tree wins, since it reflects where the process runs now. Each pane
 * keeps its first session, as resumes can leave stale hook entries behind.
 */
export function mapSessionsToTmuxPanes({entries, registry, panes, parents}: TmuxSessionPaneInputs): TmuxSessionPane[] {
	const panesByPid = new Map(panes.map((pane) => [pane.panePid, pane]));
	const cwdBySession = new Map<string, string>();
	const envPane = new Map<string, TmuxListedPane>();
	for (const entry of entries) {
		if (entry.cwd) cwdBySession.set(entry.sessionId, entry.cwd);
		if (!entry.tmuxPane) continue;
		const pane = panes.find(
			(candidate) =>
				candidate.paneId === entry.tmuxPane &&
				(entry.tmuxServerSocket === "" || candidate.socketPath === entry.tmuxServerSocket),
		);
		if (pane !== undefined && !envPane.has(entry.sessionId)) envPane.set(entry.sessionId, pane);
	}
	const processPane = new Map<string, TmuxListedPane>();
	for (const process of registry) {
		if (!cwdBySession.has(process.sessionId)) cwdBySession.set(process.sessionId, process.cwd);
		const pane = findAncestorPane(process.pid, parents, panesByPid);
		if (pane !== null && !processPane.has(process.sessionId)) processPane.set(process.sessionId, pane);
	}

	const result: TmuxSessionPane[] = [];
	const claimed = new Set<TmuxListedPane>();
	for (const sessionId of new Set([...envPane.keys(), ...processPane.keys()])) {
		const byEnv = envPane.get(sessionId);
		const byProcess = processPane.get(sessionId);
		const pane = byProcess ?? byEnv;
		if (pane === undefined || claimed.has(pane)) continue;
		claimed.add(pane);
		result.push({
			sessionId,
			cwd: cwdBySession.get(sessionId) ?? pane.currentPath,
			pane,
			via: byEnv === pane && byProcess === pane ? "both" : byProcess === pane ? "process" : "env",
		});
	}
	return result;
}

/** Runs `tmux [-S socket] list-panes -a -F TMUX_LIST_PANES_FORMAT`; null is the default server. */
export type TmuxListPanesRunner = (socket: string | null) => Promise<string>;

export interface TmuxSessionPaneSources {
	entries: () => readonly ActiveSessionEntry[];
	registry: () => readonly Pick<RegistrySessionState, "sessionId" | "pid" | "cwd">[];
	listPanes: TmuxListPanesRunner;
	/** `ps -A -o pid=,ppid=` output. */
	processTable: () => Promise<string>;
}

const TMUX_TIMEOUT_MS = 2000;

async function runFile(file: string, args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(file, args, {timeout: TMUX_TIMEOUT_MS}, (error: Error | null, stdout: string) => {
			if (error) {
				reject(error);
				return;
			}
			resolve(stdout);
		});
	});
}

export const defaultTmuxSessionPaneSources: TmuxSessionPaneSources = {
	entries: getActiveSessionEntries,
	registry: getRegistrySessionStates,
	listPanes: async (socket) =>
		runFile("tmux", [...(socket === null ? [] : ["-S", socket]), "list-panes", "-a", "-F", TMUX_LIST_PANES_FORMAT]),
	processTable: async () => runFile("ps", ["-A", "-o", "pid=,ppid="]),
};

/**
 * Every pane of the default tmux server, plus any other server a hook named by
 * socket. A server that fails (none running) contributes no panes.
 */
async function listAllPanes(
	entries: readonly ActiveSessionEntry[],
	listPanes: TmuxListPanesRunner,
): Promise<TmuxListedPane[]> {
	const read = async (socket: string | null) => {
		try {
			return parseTmuxListPanes(await listPanes(socket));
		} catch {
			return [];
		}
	};
	const panes = await read(null);
	const seenSockets = new Set(panes.map((pane) => pane.socketPath));
	const hookSockets = new Set(
		entries.flatMap((entry) =>
			entry.tmuxPane && entry.tmuxServerSocket && !seenSockets.has(entry.tmuxServerSocket)
				? [entry.tmuxServerSocket]
				: [],
		),
	);
	for (const socket of hookSockets) {
		for (const pane of await read(socket)) {
			panes.push(pane.socketPath === "" ? {...pane, socketPath: socket} : pane);
		}
	}
	return panes;
}

/** Live Claude sessions in tmux panes, by hook env and by process tree. */
export async function getTmuxSessionPanes(
	sources: TmuxSessionPaneSources = defaultTmuxSessionPaneSources,
): Promise<TmuxSessionPane[]> {
	const entries = sources.entries();
	const panes = await listAllPanes(entries, sources.listPanes);
	if (panes.length === 0) return [];
	const registry = sources.registry();
	let parents = new Map<number, number>();
	if (registry.length > 0) {
		try {
			parents = parseProcessParents(await sources.processTable());
		} catch {
			// Without ps, only a registry pid that is itself a pane pid can match.
		}
	}
	return mapSessionsToTmuxPanes({entries, registry, panes, parents});
}
