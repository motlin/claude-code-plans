import { describe, expect, it } from "vite-plus/test";
import type { ActiveSessionEntry } from "../src/lib/active-session-store";
import { getHerdrPanes, type HerdrRequester } from "../src/lib/herdr/panes";

function entry(overrides: Partial<ActiveSessionEntry>): ActiveSessionEntry {
  return {
    sessionId: "session-test-100",
    cwd: "/tmp/test/project",
    model: "claude-test-model",
    startedAt: 0,
    lastActivity: 0,
    claudeEnv: {},
    tmuxPane: "",
    tmuxServerSocket: "",
    herdrPane: "",
    herdrWorkspace: "",
    herdrSocketPath: "",
    ...overrides,
  };
}

describe("getHerdrPanes", () => {
  it("normalizes panes and joins sessions through both identity sources", async () => {
    const requests: object[] = [];
    const request: HerdrRequester = async (requestValue) => {
      requests.push(requestValue);
      return {
        ok: true,
        value: {
          type: "session_snapshot",
          snapshot: {
            version: "99.0.0-test",
            protocol: 100,
            workspaces: [],
            tabs: [],
            panes: [
              {
                pane_id: "w100:p100",
                terminal_id: "terminal-test-100",
                workspace_id: "w100",
                tab_id: "w100:t100",
                focused: true,
                cwd: "/tmp/test/project",
                foreground_cwd: "/tmp/test/project/src",
                agent_status: "working",
                agent: "claude",
                terminal_title: "Alice test terminal",
                agent_session: {
                  source: "test-source",
                  agent: "claude",
                  kind: "id",
                  value: "session-test-100",
                },
                revision: 100,
              },
              {
                pane_id: "w200:p200",
                terminal_id: "terminal-test-200",
                workspace_id: "w200",
                tab_id: "w200:t200",
                focused: false,
                cwd: null,
                foreground_cwd: null,
                agent_status: "idle",
                agent: null,
                terminal_title: null,
                agent_session: {
                  source: "test-source",
                  agent: "claude",
                  kind: "id",
                  value: "session-test-200",
                },
                revision: 200,
              },
              {
                pane_id: "w300:p300",
                terminal_id: "terminal-test-300",
                workspace_id: "w300",
                tab_id: "w300:t300",
                focused: false,
                agent_status: "blocked",
                revision: 300,
              },
              {
                pane_id: "w400:p400",
                terminal_id: "terminal-test-400",
                workspace_id: "w400",
                tab_id: "w400:t400",
                focused: false,
                agent_status: "done",
                revision: 400,
              },
            ],
            layouts: [],
            agents: [],
            focused_workspace_id: "w100",
            focused_tab_id: "w100:t100",
            focused_pane_id: "w100:p100",
          },
        },
      };
    };
    const entries = [
      entry({ sessionId: "session-test-100", herdrPane: "w100:p100" }),
      entry({ sessionId: "session-test-200" }),
      entry({ sessionId: "session-test-300", herdrPane: "w300:p300" }),
    ];

    const links = await getHerdrPanes(entries, request);

    expect({ links, requests }).toStrictEqual({
      links: [
        {
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
        },
        {
          paneId: "w200:p200",
          terminalId: "terminal-test-200",
          workspaceId: "w200",
          tabId: "w200:t200",
          focused: false,
          cwd: null,
          foregroundCwd: null,
          agentStatus: "idle",
          agent: null,
          terminalTitle: null,
          agentSessionId: "session-test-200",
          revision: 200,
          sessionId: "session-test-200",
          via: "agent-session",
        },
        {
          paneId: "w300:p300",
          terminalId: "terminal-test-300",
          workspaceId: "w300",
          tabId: "w300:t300",
          focused: false,
          cwd: null,
          foregroundCwd: null,
          agentStatus: "blocked",
          agent: null,
          terminalTitle: null,
          agentSessionId: null,
          revision: 300,
          sessionId: "session-test-300",
          via: "env",
        },
      ],
      requests: [
        {
          id: "ccp:snap",
          method: "session.snapshot",
          params: {},
        },
      ],
    });
  });

  it("returns an empty table for unavailable or invalid herdr responses", async () => {
    const unavailable: HerdrRequester = async () => ({
      ok: false,
      code: "connect-failed",
      message: "fabricated connection failure",
    });
    const invalid: HerdrRequester = async () => ({
      ok: true,
      value: { type: "unexpected-test-result" },
    });
    await expect(
      Promise.all([getHerdrPanes([], unavailable), getHerdrPanes([], invalid)]),
    ).resolves.toStrictEqual([[], []]);
  });
});
