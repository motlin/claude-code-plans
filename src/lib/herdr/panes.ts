import type { z } from "zod";
import { getActiveSessionEntries, type ActiveSessionEntry } from "../active-session-store";
import { herdrRequest, type HerdrResult } from "./client";
import { HerdrPaneInfoSchema, HerdrSessionSnapshotResultSchema } from "./schema";
import type { TerminalPlacementBase, TerminalPlacementProvider } from "../terminal-placements";

export type HerdrAgentStatus = z.infer<typeof HerdrPaneInfoSchema>["agent_status"];
type HerdrWirePane = z.infer<typeof HerdrPaneInfoSchema>;

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

const SNAPSHOT_REQUEST = {
  id: "ccp:snap",
  method: "session.snapshot",
  params: {},
};

function normalizePane(pane: HerdrWirePane): HerdrPane {
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
 * `entries` and `request` are injectable for testing; both default to the live
 * store and the Unix-socket request client. Transport and protocol failures are
 * normal when herdr is absent or has changed, so they produce an empty table.
 */
export async function getHerdrPanes(
  entries: ActiveSessionEntry[] = getActiveSessionEntries(),
  request: HerdrRequester = herdrRequest,
): Promise<HerdrPaneLink[]> {
  const response = await request(SNAPSHOT_REQUEST);
  if (!response.ok) return [];

  const parsed = HerdrSessionSnapshotResultSchema.safeParse(response.value);
  if (!parsed.success) return [];

  const entriesByPaneId = new Map<string, ActiveSessionEntry[]>();
  const entriesBySessionId = new Map(entries.map((entry) => [entry.sessionId, entry]));
  for (const entry of entries) {
    if (!entry.herdrPane) continue;
    const paneEntries = entriesByPaneId.get(entry.herdrPane);
    if (paneEntries) paneEntries.push(entry);
    else entriesByPaneId.set(entry.herdrPane, [entry]);
  }

  const links: HerdrPaneLink[] = [];
  for (const wirePane of parsed.data.snapshot.panes) {
    const pane = normalizePane(wirePane);
    const matches = new Map<
      string,
      {
        entry: ActiveSessionEntry;
        matchedByEnvironment: boolean;
        matchedByAgentSession: boolean;
      }
    >();

    for (const entry of entriesByPaneId.get(pane.paneId) ?? []) {
      matches.set(entry.sessionId, {
        entry,
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
            entry,
            matchedByEnvironment: false,
            matchedByAgentSession: true,
          });
        }
      }
    }

    for (const { entry, matchedByEnvironment, matchedByAgentSession } of matches.values()) {
      links.push({
        ...pane,
        sessionId: entry.sessionId,
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
): Promise<HerdrTerminalPlacement[]> {
  const panes = await getHerdrPanes(entries, request);
  return panes.map((pane) => ({
    provider: "herdr",
    sessionId: pane.sessionId,
    displayName: pane.terminalTitle ?? pane.foregroundCwd ?? pane.cwd ?? pane.terminalId,
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
): TerminalPlacementProvider {
  return {
    id: "herdr",
    capabilities: HERDR_CAPABILITIES,
    getPlacements: () => getHerdrPlacements(entries, request),
  };
}
