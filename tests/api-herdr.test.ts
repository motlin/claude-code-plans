import { describe, expect, it } from "vite-plus/test";
import { HerdrPaneListResponse, herdrPanesQueryOptions } from "../src/lib/api/herdr";

const linkedPane = {
  paneId: "w100:p100",
  terminalId: "terminal-test-100",
  workspaceId: "w100",
  tabId: "w100:t100",
  focused: true,
  cwd: "/tmp/test/project",
  foregroundCwd: "/tmp/test/project/src",
  agentStatus: "working",
  agent: "claude",
  terminalTitle: "Alice test terminal",
  agentSessionId: "session-test-100",
  revision: 100,
  sessionId: "session-test-100",
  via: "both",
} as const;

describe("herdr panes API contract", () => {
  it("parses the complete pane link and exposes a stable query key", () => {
    expect({
      panes: HerdrPaneListResponse.parse([linkedPane]),
      queryKey: herdrPanesQueryOptions.queryKey,
    }).toStrictEqual({
      panes: [linkedPane],
      queryKey: ["herdr", "panes"],
    });
  });

  it("rejects fields outside the ccp-owned response contract", () => {
    expect(
      HerdrPaneListResponse.safeParse([{ ...linkedPane, unexpectedTestField: true }]).success,
    ).toBe(false);
  });
});
