import { describe, expect, it, vi } from "vite-plus/test";
import type { HerdrRequester, IndexedSessionFilter } from "../src/lib/herdr/panes";
import { getHerdrWorkspaces } from "../src/lib/herdr/workspaces";

vi.mock("../src/lib/db", () => ({
  getDb: () => {
    throw new Error("Database should not be initialized");
  },
}));

interface WirePaneOverrides {
  paneId: string;
  workspaceId: string;
  tabId?: string;
  agent?: string | null;
  agentStatus?: string;
  claudeSessionId?: string | null;
  focused?: boolean;
  terminalTitle?: string;
}

function wirePane({
  paneId,
  workspaceId,
  tabId = `${workspaceId}:t1`,
  agent = null,
  agentStatus = "unknown",
  claudeSessionId = null,
  focused = false,
  terminalTitle = `Terminal ${paneId}`,
}: WirePaneOverrides) {
  return {
    pane_id: paneId,
    terminal_id: `terminal-${paneId}`,
    workspace_id: workspaceId,
    tab_id: tabId,
    focused,
    cwd: `/tmp/test/${workspaceId}`,
    foreground_cwd: `/tmp/test/${workspaceId}/src`,
    agent,
    agent_status: agentStatus,
    terminal_title: terminalTitle,
    revision: 1,
    ...(claudeSessionId === null
      ? {}
      : {
          agent_session: {
            source: "herdr:claude",
            agent: "claude",
            kind: "id",
            value: claudeSessionId,
          },
        }),
  };
}

function wireWorkspace({
  workspaceId,
  number,
  label,
  agentStatus = "idle",
  focused = false,
  tabCount = 1,
  paneCount = 1,
  worktreeRepoName,
}: {
  workspaceId: string;
  number: number;
  label: string;
  agentStatus?: string;
  focused?: boolean;
  tabCount?: number;
  paneCount?: number;
  worktreeRepoName?: string;
}) {
  return {
    workspace_id: workspaceId,
    number,
    label,
    focused,
    pane_count: paneCount,
    tab_count: tabCount,
    active_tab_id: `${workspaceId}:t1`,
    agent_status: agentStatus,
    ...(worktreeRepoName === undefined
      ? {}
      : {
          worktree: {
            repo_key: `key-${worktreeRepoName}`,
            repo_name: worktreeRepoName,
            repo_root: `/tmp/test/${worktreeRepoName}`,
            checkout_path: `/tmp/test/${worktreeRepoName}-wt`,
            is_linked_worktree: true,
          },
        }),
  };
}

function snapshotRequester(
  snapshot: Record<string, unknown>,
  requests: object[] = [],
): HerdrRequester {
  return async (request) => {
    requests.push(request);
    return {
      ok: true,
      value: {
        type: "session_snapshot",
        snapshot: {
          version: "99.0.0-test",
          protocol: 100,
          workspaces: [],
          tabs: [],
          panes: [],
          layouts: [],
          agents: [],
          ...snapshot,
        },
      },
    };
  };
}

const indexEverything: IndexedSessionFilter = (sessionIds) => new Set(sessionIds);
const indexNothing: IndexedSessionFilter = () => new Set();

describe("getHerdrWorkspaces", () => {
  it("groups panes under their workspace and separates agents from bare shells", async () => {
    const requests: object[] = [];
    const workspaces = await getHerdrWorkspaces(
      snapshotRequester(
        {
          workspaces: [
            wireWorkspace({
              workspaceId: "wA",
              number: 1,
              label: "kalshi",
              agentStatus: "idle",
              worktreeRepoName: "kalshi-upstream",
            }),
          ],
          panes: [
            wirePane({
              paneId: "wA:p1",
              workspaceId: "wA",
              agent: "claude",
              agentStatus: "idle",
              claudeSessionId: "session-test-100",
              terminalTitle: "✓ kalshi",
            }),
            wirePane({
              paneId: "wA:p2",
              workspaceId: "wA",
              agent: "codex",
              agentStatus: "working",
              terminalTitle: "codex kalshi",
            }),
            wirePane({ paneId: "wA:p3", workspaceId: "wA", terminalTitle: "kalshi shell" }),
          ],
        },
        requests,
      ),
      indexEverything,
    );

    expect({ requests, workspaces }).toStrictEqual({
      requests: [{ id: "ccp:snap", method: "session.snapshot", params: {} }],
      workspaces: [
        {
          workspaceId: "wA",
          number: 1,
          label: "kalshi",
          agentStatus: "idle",
          worktreeName: "kalshi-upstream",
          agentPanes: [
            {
              paneId: "wA:p2",
              agent: "codex",
              agentStatus: "working",
              sessionId: null,
              title: "codex kalshi",
            },
            {
              paneId: "wA:p1",
              agent: "claude",
              agentStatus: "idle",
              sessionId: "session-test-100",
              title: "✓ kalshi",
            },
          ],
          shellPanes: [
            {
              paneId: "wA:p3",
              agent: null,
              agentStatus: "unknown",
              sessionId: null,
              title: "kalshi shell",
            },
          ],
        },
      ],
    });
  });

  it("only links a Claude pane whose transcript ccp has indexed", async () => {
    const snapshot = {
      workspaces: [wireWorkspace({ workspaceId: "wA", number: 1, label: "kalshi" })],
      panes: [
        wirePane({
          paneId: "wA:p1",
          workspaceId: "wA",
          agent: "claude",
          claudeSessionId: "session-test-100",
        }),
      ],
    };

    const [indexed, unindexed] = await Promise.all([
      getHerdrWorkspaces(snapshotRequester(snapshot), indexEverything),
      getHerdrWorkspaces(snapshotRequester(snapshot), indexNothing),
    ]);

    expect({
      indexed: indexed[0]?.agentPanes.map((pane) => pane.sessionId),
      unindexed: unindexed[0]?.agentPanes.map((pane) => pane.sessionId),
    }).toStrictEqual({ indexed: ["session-test-100"], unindexed: [null] });
  });

  it("orders workspaces by how much attention they need, then by workspace number", async () => {
    const workspaces = await getHerdrWorkspaces(
      snapshotRequester({
        workspaces: [
          wireWorkspace({ workspaceId: "w1", number: 1, label: "idle-one", agentStatus: "idle" }),
          wireWorkspace({ workspaceId: "w2", number: 2, label: "working", agentStatus: "working" }),
          wireWorkspace({ workspaceId: "w3", number: 3, label: "blocked", agentStatus: "blocked" }),
          wireWorkspace({ workspaceId: "w4", number: 4, label: "done", agentStatus: "done" }),
          wireWorkspace({ workspaceId: "w5", number: 5, label: "idle-two", agentStatus: "idle" }),
        ],
      }),
      indexEverything,
    );

    expect(workspaces.map((workspace) => workspace.label)).toStrictEqual([
      "blocked",
      "done",
      "working",
      "idle-one",
      "idle-two",
    ]);
  });

  it("keeps panes whose workspace is missing from the snapshot visible under a placeholder", async () => {
    const workspaces = await getHerdrWorkspaces(
      snapshotRequester({
        workspaces: [],
        panes: [wirePane({ paneId: "wZ:p1", workspaceId: "wZ", agent: "claude" })],
      }),
      indexEverything,
    );

    expect(
      workspaces.map((workspace) => ({
        workspaceId: workspace.workspaceId,
        label: workspace.label,
        number: workspace.number,
        agentPaneIds: workspace.agentPanes.map((pane) => pane.paneId),
      })),
    ).toStrictEqual([{ workspaceId: "wZ", label: "wZ", number: 0, agentPaneIds: ["wZ:p1"] }]);
  });

  it("returns no workspaces when herdr is unreachable or the protocol drifted", async () => {
    const unreachable: HerdrRequester = async () => ({
      ok: false,
      code: "connect-failed",
      message: "no herdr socket",
    });
    const drifted: HerdrRequester = async () => ({ ok: true, value: { type: "surprise" } });

    const [unreachable_, drifted_] = await Promise.all([
      getHerdrWorkspaces(unreachable, indexEverything),
      getHerdrWorkspaces(drifted, indexEverything),
    ]);

    expect({ unreachable: unreachable_, drifted: drifted_ }).toStrictEqual({
      unreachable: [],
      drifted: [],
    });
  });
});
