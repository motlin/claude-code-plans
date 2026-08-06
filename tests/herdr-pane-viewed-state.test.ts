import { describe, expect, it } from "vite-plus/test";
import { openTestDb } from "../src/lib/db/connection";
import {
  linkHerdrTerminalToSession,
  markSessionUnreviewed,
  setHerdrTerminalViewed,
} from "../src/lib/db/viewed-state";
import { addViewedStateToHerdrPanes } from "../src/lib/herdr/pane-viewed-state";
import type { HerdrPaneLink } from "../src/lib/herdr/panes";

function pane(terminalId: string, agentStatus: string): HerdrPaneLink {
  return {
    paneId: `workspace-100:pane-${terminalId}`,
    terminalId,
    workspaceId: "workspace-100",
    tabId: "workspace-100:tab-100",
    focused: false,
    cwd: "/tmp/test/project",
    foregroundCwd: "/tmp/test/project/src",
    agentStatus,
    agent: "claude",
    terminalTitle: "Alice test terminal",
    agentSessionId: "session-test-100",
    revision: 100,
    sessionId: "session-test-100",
    via: "both",
  };
}

describe("herdr pane viewed-state projection", () => {
  it("prunes stale terminal hints and sorts using workspace attention", () => {
    const db = openTestDb();
    try {
      markSessionUnreviewed(db.index, "session-test-100", 0, 1_000);
      linkHerdrTerminalToSession(db.index, "terminal-test-old", "session-test-100", 2_000);
      setHerdrTerminalViewed(db.index, "terminal-test-old", "session-test-100", true, 3_000);

      const projected = addViewedStateToHerdrPanes(db.index, [
        pane("terminal-test-idle", "idle"),
        pane("terminal-test-blocked", "blocked"),
      ]);

      expect(projected).toStrictEqual([
        {
          ...pane("terminal-test-blocked", "blocked"),
          viewedState: {
            currentMessageIndex: -1,
            lastViewedMessageIndex: -1,
            reviewTargetMessageIndex: 0,
            newMessageCount: 0,
            viewedInCcp: false,
            viewedInHerdr: false,
            viewedAnywhere: false,
          },
        },
        {
          ...pane("terminal-test-idle", "idle"),
          viewedState: {
            currentMessageIndex: -1,
            lastViewedMessageIndex: -1,
            reviewTargetMessageIndex: 0,
            newMessageCount: 0,
            viewedInCcp: false,
            viewedInHerdr: false,
            viewedAnywhere: false,
          },
        },
      ]);
    } finally {
      db.close();
    }
  });
});
