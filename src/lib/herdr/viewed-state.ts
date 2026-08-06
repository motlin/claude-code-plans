import type { HerdrPaneLink } from "./panes";

type HerdrAttentionStatus = "blocked" | "done" | "working" | "idle" | "unknown";

interface AgentStatusPart {
  agent: string | null;
  status: string;
}

interface TrackedPane {
  sessionId: string;
  terminalId: string;
}

export interface HerdrViewedStateTrackerDependencies {
  isSessionVisible: (sessionId: string) => boolean;
  linkTerminal: (terminalId: string, sessionId: string) => void;
  pruneTerminalLinks: (sessionId: string, activeTerminalIds: string[]) => void;
  markSessionCompletionUnreviewed: (sessionId: string) => void;
  markTerminalUnviewed: (terminalId: string, sessionId: string) => void;
  markTerminalViewed: (terminalId: string, sessionId: string) => void;
}

function completionStatus(status: string): string {
  return status === "done" ? "idle" : status;
}

/** Match herdr's completion rule while accounting for its derived `done` wire status. */
export function isCompletionTransitionParts(
  previous: AgentStatusPart,
  next: AgentStatusPart,
): boolean {
  const previousStatus = completionStatus(previous.status);
  const nextStatus = completionStatus(next.status);
  if (nextStatus !== "idle") return false;
  if (previousStatus === "working" || previousStatus === "blocked") return true;
  return (
    previousStatus === "unknown" &&
    previous.agent !== null &&
    next.agent !== null &&
    previous.agent === next.agent
  );
}

const ATTENTION_RANK: Readonly<Record<HerdrAttentionStatus, number>> = {
  blocked: 0,
  done: 1,
  working: 2,
  idle: 3,
  unknown: 4,
};

function knownAttentionStatus(status: string): HerdrAttentionStatus {
  return status in ATTENTION_RANK ? (status as HerdrAttentionStatus) : "unknown";
}

/** Copy herdr's workspace ordering, where completed work outranks active work. */
export function compareHerdrAttention(
  left: Pick<HerdrPaneLink, "agentStatus">,
  right: Pick<HerdrPaneLink, "agentStatus">,
): number {
  return (
    ATTENTION_RANK[knownAttentionStatus(left.agentStatus)] -
    ATTENTION_RANK[knownAttentionStatus(right.agentStatus)]
  );
}

export function createHerdrViewedStateTracker(dependencies: HerdrViewedStateTrackerDependencies): {
  syncPanes: (panes: HerdrPaneLink[]) => void;
  handleStatusEvent: (data: Record<string, unknown>) => void;
} {
  const panesByPaneId = new Map<string, TrackedPane>();
  const statusByTerminalId = new Map<string, AgentStatusPart>();

  const syncPanes = (panes: HerdrPaneLink[]): void => {
    panesByPaneId.clear();
    const terminalIdsBySessionId = new Map<string, string[]>();
    for (const pane of panes) {
      panesByPaneId.set(pane.paneId, {
        sessionId: pane.sessionId,
        terminalId: pane.terminalId,
      });
      statusByTerminalId.set(pane.terminalId, {
        status: pane.agentStatus,
        agent: pane.agent,
      });
      // A snapshot can follow a herdr restart, which resets its server-side
      // `seen` bit. Seed transition state, but never manufacture a viewed edge.
      dependencies.linkTerminal(pane.terminalId, pane.sessionId);
      const terminalIds = terminalIdsBySessionId.get(pane.sessionId);
      if (terminalIds) terminalIds.push(pane.terminalId);
      else terminalIdsBySessionId.set(pane.sessionId, [pane.terminalId]);
    }
    for (const [sessionId, terminalIds] of terminalIdsBySessionId) {
      dependencies.pruneTerminalLinks(sessionId, terminalIds);
    }
  };

  const handleStatusEvent = (data: Record<string, unknown>): void => {
    const paneId = data["pane_id"];
    const agentStatus = data["agent_status"];
    const agent = data["agent"];
    if (
      typeof paneId !== "string" ||
      typeof agentStatus !== "string" ||
      (agent !== undefined && agent !== null && typeof agent !== "string")
    ) {
      return;
    }

    const pane = panesByPaneId.get(paneId);
    if (!pane) return;

    const next: AgentStatusPart = {
      status: agentStatus,
      agent: typeof agent === "string" ? agent : null,
    };
    const previous = statusByTerminalId.get(pane.terminalId);
    statusByTerminalId.set(pane.terminalId, next);
    if (!previous) return;

    if (previous.status === "done" && next.status === "idle") {
      dependencies.markTerminalViewed(pane.terminalId, pane.sessionId);
    }

    if (isCompletionTransitionParts(previous, next)) {
      dependencies.markTerminalUnviewed(pane.terminalId, pane.sessionId);
      if (!dependencies.isSessionVisible(pane.sessionId)) {
        dependencies.markSessionCompletionUnreviewed(pane.sessionId);
      }
    }
  };

  return { syncPanes, handleStatusEvent };
}
