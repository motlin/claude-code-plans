import { describe, expect, it } from "vite-plus/test";
import type { ActiveSessionEntry } from "../src/lib/active-session-store";
import { createHerdrPlacementProvider, type HerdrRequester } from "../src/lib/herdr/panes";
import {
  getTerminalPlacements,
  type TerminalPlacementProvider,
} from "../src/lib/terminal-placements";
import { createTmuxPlacementProvider } from "../src/lib/tmux-windows";

function entry(overrides: Partial<ActiveSessionEntry>): ActiveSessionEntry {
  return {
    sessionId: "session-test-100",
    cwd: "/tmp/test/alice-project",
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

function herdrSnapshot(sessionId = "session-test-200"): HerdrRequester {
  return async () => ({
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
            pane_id: "w200:p200",
            terminal_id: "terminal-test-200",
            workspace_id: "w200",
            tab_id: "w200:t200",
            focused: true,
            cwd: "/tmp/test/bob-project",
            foreground_cwd: "/tmp/test/bob-project/src",
            agent_status: "working",
            agent: "claude",
            terminal_title: "Bob test terminal",
            agent_session: {
              source: "test-source",
              agent: "claude",
              kind: "id",
              value: sessionId,
            },
            revision: 200,
          },
        ],
        layouts: [],
        agents: [],
        focused_workspace_id: "w200",
        focused_tab_id: "w200:t200",
        focused_pane_id: "w200:p200",
      },
    },
  });
}

function tmuxProvider(sessionId = "session-test-100"): TerminalPlacementProvider {
  return createTmuxPlacementProvider(
    [
      entry({
        sessionId,
        tmuxPane: "%100",
        tmuxServerSocket: "/tmp/test/tmux.sock",
      }),
    ],
    async () => "%100\ttest-session\t10\tAlice test window\t1\n",
  );
}

function herdrProvider(sessionId = "session-test-200"): TerminalPlacementProvider {
  return createHerdrPlacementProvider(
    [entry({ sessionId, herdrPane: "w200:p200" })],
    herdrSnapshot(sessionId),
  );
}

describe("terminal placement providers", () => {
  it("reports a tmux-only fleet without changing the native tmux record", async () => {
    await expect(getTerminalPlacements([tmuxProvider()])).resolves.toStrictEqual([
      {
        provider: "tmux",
        sessionId: "session-test-100",
        displayName: "Alice test window",
        active: true,
        paneHandle: "%100",
        scopeHandle: "/tmp/test/tmux.sock",
        capabilities: {
          supportsWrite: false,
          supportsEvents: false,
          supportsObserve: false,
        },
        tmuxWindow: {
          sessionId: "session-test-100",
          projectName: "alice-project",
          windowIndex: 10,
          windowName: "Alice test window",
          windowActive: true,
          tmuxPane: "%100",
          socket: "/tmp/test/tmux.sock",
        },
      },
    ]);
  });

  it("reports a herdr-only fleet with the complete pane read model", async () => {
    await expect(getTerminalPlacements([herdrProvider()])).resolves.toStrictEqual([
      {
        provider: "herdr",
        sessionId: "session-test-200",
        displayName: "Bob test terminal",
        active: true,
        paneHandle: "w200:p200",
        scopeHandle: "w200",
        capabilities: {
          supportsWrite: true,
          supportsEvents: true,
          supportsObserve: true,
        },
        herdrPane: {
          paneId: "w200:p200",
          terminalId: "terminal-test-200",
          workspaceId: "w200",
          tabId: "w200:t200",
          focused: true,
          cwd: "/tmp/test/bob-project",
          foregroundCwd: "/tmp/test/bob-project/src",
          agentStatus: "working",
          agent: "claude",
          terminalTitle: "Bob test terminal",
          agentSessionId: "session-test-200",
          revision: 200,
          sessionId: "session-test-200",
          via: "both",
        },
      },
    ]);
  });

  it("merges independently available providers in deterministic order", async () => {
    const placements = await getTerminalPlacements([herdrProvider(), tmuxProvider()]);

    expect(placements.map(({ provider, sessionId }) => ({ provider, sessionId }))).toStrictEqual([
      { provider: "tmux", sessionId: "session-test-100" },
      { provider: "herdr", sessionId: "session-test-200" },
    ]);
  });

  it("prefers herdr when both providers report the same session id", async () => {
    const placements = await getTerminalPlacements([
      tmuxProvider("session-test-200"),
      herdrProvider("session-test-200"),
    ]);

    expect(placements.map(({ provider, sessionId }) => ({ provider, sessionId }))).toStrictEqual([
      { provider: "herdr", sessionId: "session-test-200" },
    ]);
  });

  it("models each provider's capabilities explicitly", async () => {
    const providers = [tmuxProvider(), herdrProvider()];
    const placements = await getTerminalPlacements(providers);

    expect({
      providers: providers.map(({ id, capabilities }) => ({ id, capabilities })),
      placements: placements.map(({ provider, capabilities }) => ({ provider, capabilities })),
    }).toStrictEqual({
      providers: [
        {
          id: "tmux",
          capabilities: {
            supportsWrite: false,
            supportsEvents: false,
            supportsObserve: false,
          },
        },
        {
          id: "herdr",
          capabilities: {
            supportsWrite: true,
            supportsEvents: true,
            supportsObserve: true,
          },
        },
      ],
      placements: [
        {
          provider: "tmux",
          capabilities: {
            supportsWrite: false,
            supportsEvents: false,
            supportsObserve: false,
          },
        },
        {
          provider: "herdr",
          capabilities: {
            supportsWrite: true,
            supportsEvents: true,
            supportsObserve: true,
          },
        },
      ],
    });
  });

  it("isolates a rejected provider from the remaining fleet", async () => {
    const rejectedProvider: TerminalPlacementProvider = {
      id: "herdr",
      capabilities: {
        supportsWrite: true,
        supportsEvents: true,
        supportsObserve: true,
      },
      getPlacements: async () => {
        throw new Error("Fabricated provider failure");
      },
    };

    const placements = await getTerminalPlacements([rejectedProvider, tmuxProvider()]);

    expect(placements.map(({ provider, sessionId }) => ({ provider, sessionId }))).toStrictEqual([
      { provider: "tmux", sessionId: "session-test-100" },
    ]);
  });

  it("isolates an unavailable herdr response from the tmux provider", async () => {
    const unavailableHerdr = createHerdrPlacementProvider([], async () => ({
      ok: false,
      code: "connect-failed",
      message: "Fabricated unavailable herdr service",
    }));

    const placements = await getTerminalPlacements([unavailableHerdr, tmuxProvider()]);

    expect(placements.map(({ provider, sessionId }) => ({ provider, sessionId }))).toStrictEqual([
      { provider: "tmux", sessionId: "session-test-100" },
    ]);
  });
});
