import type { z } from "zod";
import { getActiveSessionEntries, type ActiveSessionEntry } from "../active-session-store";
import { getDb } from "../db";
import { getIndexedSessionIds } from "../db/queries";
import { herdrRequest, type HerdrResult } from "./client";
import { HerdrPaneInfoSchema, HerdrSessionSnapshotResultSchema } from "./schema";
import type { TerminalPlacementBase, TerminalPlacementProvider } from "../terminal-placements";

export type HerdrAgentStatus = z.infer<typeof HerdrPaneInfoSchema>["agent_status"];
export type HerdrWirePane = z.infer<typeof HerdrPaneInfoSchema>;
type HerdrSnapshot = z.infer<typeof HerdrSessionSnapshotResultSchema>["snapshot"];

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

export interface HerdrPaneLink extends HerdrPane {
  sessionId: string;
  via: "env" | "agent-session" | "both";
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

export type HerdrRequester = (request: object, timeoutMs?: number) => Promise<HerdrResult<unknown>>;
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
 * Fetch and decode herdr's live session snapshot for every read model above it.
 *
 * Transport and protocol failures are normal when herdr is absent or has
 * changed release, so both collapse to `null` and each caller degrades to an
 * empty result instead of failing.
 */
export async function readHerdrSnapshot(request: HerdrRequester): Promise<HerdrSnapshot | null> {
  const response = await request(SNAPSHOT_REQUEST);
  if (!response.ok) return null;
  const parsed = HerdrSessionSnapshotResultSchema.safeParse(response.value);
  return parsed.success ? parsed.data.snapshot : null;
}

/** The Claude transcript id herdr resolved for a pane, if the pane runs Claude at all. */
export function claudeSessionId(pane: HerdrWirePane): string | null {
  const session = pane.agent_session;
  if (!session || session.kind !== "id" || session.agent !== "claude") return null;
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
): Promise<HerdrPaneLink[]> {
  const snapshot = await readHerdrSnapshot(request);
  if (snapshot === null) return [];

  const entriesByPaneId = new Map<string, ActiveSessionEntry[]>();
  const entriesBySessionId = new Map(entries.map((entry) => [entry.sessionId, entry]));
  for (const entry of entries) {
    if (!entry.herdrPane) continue;
    const paneEntries = entriesByPaneId.get(entry.herdrPane);
    if (paneEntries) paneEntries.push(entry);
    else entriesByPaneId.set(entry.herdrPane, [entry]);
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

    for (const [sessionId, { matchedByEnvironment, matchedByAgentSession }] of matches) {
      links.push({
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
    getPlacements: () => getHerdrPlacements(entries, request, indexedSessionFilter),
  };
}
