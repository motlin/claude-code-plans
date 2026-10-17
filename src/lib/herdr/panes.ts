import type {z} from "zod";
import {getActiveSessionEntries, type ActiveSessionEntry} from "../active-session-store";
import {getDb} from "../db";
import {getIndexedSessionIds} from "../db/queries";
import {herdrRequest, type HerdrResult} from "./client";
import {herdrPaneTable, type HerdrPaneReader, type HerdrPaneState} from "./pane-table";
import {HerdrPaneInfoSchema, HerdrSessionSnapshotResultSchema} from "./schema";
import {knownHerdrServers, qualifiedEntryHerdrPane, qualifyHerdrPaneState, type HerdrServer} from "./servers";
import type {TerminalPlacementBase, TerminalPlacementProvider} from "../terminal-placements";

export type HerdrAgentStatus = z.infer<typeof HerdrPaneInfoSchema>["agent_status"];
export type HerdrWirePane = z.infer<typeof HerdrPaneInfoSchema>;

export interface HerdrPane {
	paneId: string;
	terminalId: string;
	workspaceId: string;
	tabId: string;
	focused: boolean;
	cwd: string | null;
	foregroundCwd: string | null;
	agentStatus: HerdrAgentStatus;
	agent: string | null;
	terminalTitle: string | null;
	agentSessionId: string | null;
	revision: number;
}

/**
 * A live pane tied to a Claude session. tmux panes reuse this shape (see
 * `src/lib/tmux/pane-links.ts`), so `host` says which multiplexer owns it and
 * `via: "process"` marks a tmux match found through the session's pid.
 */
export interface HerdrPaneLink extends HerdrPane {
	host: "herdr" | "tmux";
	sessionId: string;
	via: "env" | "agent-session" | "process" | "both";
}

export interface HerdrTerminalPlacement extends TerminalPlacementBase {
	provider: "herdr";
	herdrPane: HerdrPaneLink;
}

const HERDR_CAPABILITIES = {
	supportsWrite: true,
	supportsEvents: true,
	supportsObserve: true,
};

/** `socketPath` pins the server; without it the request is routed by the qualified ids in its params. */
export type HerdrRequester = (
	request: object,
	timeoutMs?: number,
	socketPath?: string,
) => Promise<HerdrResult<unknown>>;
export type HerdrServerLister = () => readonly HerdrServer[];
export type IndexedSessionFilter = (sessionIds: string[]) => Set<string>;

export const filterIndexedSessions: IndexedSessionFilter = (sessionIds) => {
	if (sessionIds.length === 0) return new Set();
	return getIndexedSessionIds(getDb().index, sessionIds);
};

const SNAPSHOT_REQUEST = {
	id: "ccp:snap",
	method: "session.snapshot",
	params: {},
};

/**
 * Read herdr's live pane state, across every known herdr server, for every read model above it.
 *
 * While the event bridges keep the pane tables current, this is a memory read.
 * Otherwise it asks each server for a snapshot and merges them with
 * qualified ids. A server that fails contributes nothing; only when every
 * server fails is the first failure returned.
 */
export async function readHerdrPaneState(
	request: HerdrRequester,
	table: HerdrPaneReader = herdrPaneTable,
	servers: HerdrServerLister = knownHerdrServers,
): Promise<HerdrResult<HerdrPaneState>> {
	const current = table.current();
	if (current !== null) return {ok: true, value: current};
	const states: HerdrPaneState[] = [];
	let firstFailure: Extract<HerdrResult<unknown>, {ok: false}> | null = null;
	for (const server of servers()) {
		const response = await request(SNAPSHOT_REQUEST, undefined, server.socketPath);
		if (!response.ok) {
			firstFailure ??= response;
			continue;
		}
		const parsed = HerdrSessionSnapshotResultSchema.safeParse(response.value);
		if (!parsed.success) {
			firstFailure ??= {ok: false, code: "bad-response", message: "herdr returned an invalid session snapshot"};
			continue;
		}
		const {workspaces, panes} = parsed.data.snapshot;
		states.push(qualifyHerdrPaneState({workspaces, panes}, server.session));
	}
	if (states.length === 0) {
		return firstFailure ?? {ok: false, code: "no-server", message: "no herdr server is known"};
	}
	return {
		ok: true,
		value: {
			workspaces: states.flatMap((state) => state.workspaces),
			panes: states.flatMap((state) => state.panes),
		},
	};
}

/** `readHerdrPaneState`, with every failure collapsed to `null` so callers degrade to an empty result. */
export async function readHerdrSnapshot(
	request: HerdrRequester,
	table: HerdrPaneReader = herdrPaneTable,
	servers: HerdrServerLister = knownHerdrServers,
): Promise<HerdrPaneState | null> {
	const result = await readHerdrPaneState(request, table, servers);
	return result.ok ? result.value : null;
}

/** The Claude transcript id herdr resolved for a pane, if the pane runs Claude at all. */
export function claudeSessionId(pane: HerdrWirePane): string | null {
	const session = pane.agent_session;
	if (session?.kind !== "id" || session.agent !== "claude") return null;
	return session.value;
}

/** Single naming policy so a pane reads the same in every Herdr view. */
export function herdrPaneDisplayName(pane: HerdrPane): string {
	return pane.terminalTitle ?? pane.foregroundCwd ?? pane.cwd ?? pane.terminalId;
}

export function normalizePane(pane: HerdrWirePane): HerdrPane {
	return {
		paneId: pane.pane_id,
		terminalId: pane.terminal_id,
		workspaceId: pane.workspace_id,
		tabId: pane.tab_id,
		focused: pane.focused,
		cwd: pane.cwd ?? null,
		foregroundCwd: pane.foreground_cwd ?? null,
		agentStatus: pane.agent_status,
		agent: pane.agent ?? null,
		terminalTitle: pane.terminal_title ?? null,
		agentSessionId: pane.agent_session?.value ?? null,
		revision: pane.revision,
	};
}

/**
 * Join herdr's live pane snapshot to active ccp sessions.
 *
 * Dependencies are injectable for testing and default to the live session
 * store, Unix-socket request client, and indexed sessions. Transport and
 * protocol failures are normal when herdr is absent or has changed, so they
 * produce an empty table.
 */
export async function getHerdrPanes(
	entries: ActiveSessionEntry[] = getActiveSessionEntries(),
	request: HerdrRequester = herdrRequest,
	indexedSessionFilter: IndexedSessionFilter = filterIndexedSessions,
	table: HerdrPaneReader = herdrPaneTable,
	servers: HerdrServerLister = knownHerdrServers,
): Promise<HerdrPaneLink[]> {
	const snapshot = await readHerdrSnapshot(request, table, servers);
	return snapshot === null ? [] : linkHerdrPanes(snapshot, entries, indexedSessionFilter);
}

/** Join a herdr pane snapshot to active ccp sessions and indexed transcripts, without asking herdr. */
export function linkHerdrPanes(
	snapshot: HerdrPaneState,
	entries: ActiveSessionEntry[],
	indexedSessionFilter: IndexedSessionFilter,
): HerdrPaneLink[] {
	const entriesByPaneId = new Map<string, ActiveSessionEntry[]>();
	const entriesBySessionId = new Map(entries.map((entry) => [entry.sessionId, entry]));
	for (const entry of entries) {
		const paneId = qualifiedEntryHerdrPane(entry);
		if (!paneId) continue;
		const paneEntries = entriesByPaneId.get(paneId);
		if (paneEntries) paneEntries.push(entry);
		else entriesByPaneId.set(paneId, [entry]);
	}

	const indexedSessionCandidates = snapshot.panes.flatMap((pane) => {
		const sessionId = claudeSessionId(pane);
		return sessionId === null ? [] : [sessionId];
	});
	const indexedSessionIds = indexedSessionFilter(indexedSessionCandidates);

	const links: HerdrPaneLink[] = [];
	for (const wirePane of snapshot.panes) {
		const pane = normalizePane(wirePane);
		const matches = new Map<
			string,
			{
				matchedByEnvironment: boolean;
				matchedByAgentSession: boolean;
			}
		>();

		for (const entry of entriesByPaneId.get(pane.paneId) ?? []) {
			matches.set(entry.sessionId, {
				matchedByEnvironment: true,
				matchedByAgentSession: false,
			});
		}

		if (pane.agentSessionId) {
			const entry = entriesBySessionId.get(pane.agentSessionId);
			if (entry) {
				const match = matches.get(entry.sessionId);
				if (match) match.matchedByAgentSession = true;
				else {
					matches.set(entry.sessionId, {
						matchedByEnvironment: false,
						matchedByAgentSession: true,
					});
				}
			}
		}

		const indexedClaudeSessionId = claudeSessionId(wirePane);
		if (
			indexedClaudeSessionId !== null &&
			indexedSessionIds.has(indexedClaudeSessionId) &&
			!matches.has(indexedClaudeSessionId)
		) {
			matches.set(indexedClaudeSessionId, {
				matchedByEnvironment: false,
				matchedByAgentSession: true,
			});
		}

		for (const [sessionId, {matchedByEnvironment, matchedByAgentSession}] of matches) {
			links.push({
				host: "herdr",
				...pane,
				sessionId,
				via:
					matchedByEnvironment && matchedByAgentSession
						? "both"
						: matchedByEnvironment
							? "env"
							: "agent-session",
			});
		}
	}

	return links;
}

async function getHerdrPlacements(
	entries: ActiveSessionEntry[] = getActiveSessionEntries(),
	request: HerdrRequester = herdrRequest,
	indexedSessionFilter: IndexedSessionFilter = filterIndexedSessions,
): Promise<HerdrTerminalPlacement[]> {
	const panes = await getHerdrPanes(entries, request, indexedSessionFilter);
	return panes.map((pane) => ({
		provider: "herdr",
		sessionId: pane.sessionId,
		displayName: herdrPaneDisplayName(pane),
		active: pane.focused,
		paneHandle: pane.paneId,
		scopeHandle: pane.workspaceId,
		capabilities: HERDR_CAPABILITIES,
		herdrPane: pane,
	}));
}

export function createHerdrPlacementProvider(
	entries: ActiveSessionEntry[] = getActiveSessionEntries(),
	request: HerdrRequester = herdrRequest,
	indexedSessionFilter: IndexedSessionFilter = filterIndexedSessions,
): TerminalPlacementProvider {
	return {
		id: "herdr",
		capabilities: HERDR_CAPABILITIES,
		getPlacements: async () => getHerdrPlacements(entries, request, indexedSessionFilter),
	};
}
