import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { DurableSessionViewedState } from "../db/viewed-state";
import {
  getCurrentSessionMessageIndex,
  getSessionViewedState,
  linkHerdrTerminalToSession,
  pruneHerdrTerminalLinks,
} from "../db/viewed-state";
import * as schema from "../db/schema";
import type { HerdrPaneLink } from "./panes";
import { compareHerdrAttention } from "./viewed-state";

type IndexDb = BetterSQLite3Database<typeof schema>;

interface HerdrPaneWithViewedState extends HerdrPaneLink {
  viewedState: DurableSessionViewedState;
}

export function addViewedStateToHerdrPanes(
  db: IndexDb,
  panes: HerdrPaneLink[],
): HerdrPaneWithViewedState[] {
  const currentMessageIndices = new Map<string, number>();
  const viewedStates = new Map<string, DurableSessionViewedState>();
  const terminalIdsBySessionId = new Map<string, string[]>();

  for (const pane of panes) {
    linkHerdrTerminalToSession(db, pane.terminalId, pane.sessionId);
    const terminalIds = terminalIdsBySessionId.get(pane.sessionId);
    if (terminalIds) terminalIds.push(pane.terminalId);
    else terminalIdsBySessionId.set(pane.sessionId, [pane.terminalId]);
    if (!currentMessageIndices.has(pane.sessionId)) {
      currentMessageIndices.set(pane.sessionId, getCurrentSessionMessageIndex(db, pane.sessionId));
    }
  }

  for (const [sessionId, terminalIds] of terminalIdsBySessionId) {
    pruneHerdrTerminalLinks(db, sessionId, terminalIds);
  }

  for (const pane of panes) {
    if (!viewedStates.has(pane.sessionId)) {
      viewedStates.set(
        pane.sessionId,
        getSessionViewedState(db, pane.sessionId, currentMessageIndices.get(pane.sessionId)!),
      );
    }
  }

  return panes
    .map((pane) => ({ ...pane, viewedState: viewedStates.get(pane.sessionId)! }))
    .sort(compareHerdrAttention);
}
