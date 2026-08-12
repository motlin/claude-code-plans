import { herdrRequest } from "./client";
import {
  claudeSessionId,
  filterIndexedSessions,
  herdrPaneDisplayName,
  normalizePane,
  readHerdrSnapshot,
  type HerdrAgentStatus,
  type HerdrRequester,
  type IndexedSessionFilter,
} from "./panes";
import { compareHerdrAttention } from "./viewed-state";

export interface HerdrWorkspacePane {
  paneId: string;
  title: string;
  /** `null` for a bare shell — the pane runs no agent herdr recognizes. */
  agent: string | null;
  agentStatus: HerdrAgentStatus;
  /** Claude transcript id, present only when ccp has that transcript indexed. */
  sessionId: string | null;
}

export interface HerdrWorkspace {
  workspaceId: string;
  number: number;
  label: string;
  agentStatus: HerdrAgentStatus;
  worktreeName: string | null;
  agentPanes: HerdrWorkspacePane[];
  /**
   * Panes running no agent. Kept apart from `agentPanes` so a navigator can
   * collapse them: a real fleet is roughly half bare shells, and listing all of
   * them inline buries the agents the user actually came to look at.
   */
  shellPanes: HerdrWorkspacePane[];
}

function placeholderWorkspace(workspaceId: string): HerdrWorkspace {
  return {
    workspaceId,
    number: 0,
    label: workspaceId,
    agentStatus: "unknown",
    worktreeName: null,
    agentPanes: [],
    shellPanes: [],
  };
}

function comparePanes(left: HerdrWorkspacePane, right: HerdrWorkspacePane): number {
  return compareHerdrAttention(left, right) || left.title.localeCompare(right.title);
}

/**
 * Read herdr's live session snapshot as a workspace -> pane tree.
 *
 * This is deliberately separate from `getHerdrPanes`, which throws away every
 * pane that does not join to an indexed Claude transcript. A navigator has to
 * show the whole fleet — Codex panes and bare shells included — so it needs the
 * workspaces, labels, and unlinked panes that the placement path discards.
 */
export async function getHerdrWorkspaces(
  request: HerdrRequester = herdrRequest,
  indexedSessionFilter: IndexedSessionFilter = filterIndexedSessions,
): Promise<HerdrWorkspace[]> {
  const snapshot = await readHerdrSnapshot(request);
  if (snapshot === null) return [];

  const panes = snapshot.panes.map((wirePane) => {
    const pane = normalizePane(wirePane);
    return {
      workspaceId: pane.workspaceId,
      claudeSessionId: claudeSessionId(wirePane),
      paneId: pane.paneId,
      title: herdrPaneDisplayName(pane),
      agent: pane.agent,
      agentStatus: pane.agentStatus,
    };
  });
  const indexedSessionIds = indexedSessionFilter(
    panes.flatMap((pane) => (pane.claudeSessionId === null ? [] : [pane.claudeSessionId])),
  );

  const workspaces = new Map<string, HerdrWorkspace>(
    snapshot.workspaces.map((workspace) => [
      workspace.workspace_id,
      {
        workspaceId: workspace.workspace_id,
        number: workspace.number,
        label: workspace.label,
        agentStatus: workspace.agent_status,
        worktreeName: workspace.worktree?.repo_name ?? null,
        agentPanes: [],
        shellPanes: [],
      },
    ]),
  );

  for (const { workspaceId, claudeSessionId: sessionId, ...rest } of panes) {
    let workspace = workspaces.get(workspaceId);
    if (!workspace) {
      workspace = placeholderWorkspace(workspaceId);
      workspaces.set(workspaceId, workspace);
    }

    const pane: HerdrWorkspacePane = {
      ...rest,
      sessionId: sessionId !== null && indexedSessionIds.has(sessionId) ? sessionId : null,
    };
    if (pane.agent === null) workspace.shellPanes.push(pane);
    else workspace.agentPanes.push(pane);
  }

  for (const workspace of workspaces.values()) {
    workspace.agentPanes.sort(comparePanes);
    workspace.shellPanes.sort(comparePanes);
  }

  return [...workspaces.values()].sort(
    (left, right) => compareHerdrAttention(left, right) || left.number - right.number,
  );
}
