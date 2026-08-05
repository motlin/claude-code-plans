import { describe, expect, it } from "vite-plus/test";
import { getTmuxWindows, parseTmuxPanes, type TmuxWindow } from "../src/lib/tmux-windows";
import type { ActiveSessionEntry } from "../src/lib/active-session-store";

function entry(overrides: Partial<ActiveSessionEntry>): ActiveSessionEntry {
  return {
    sessionId: "s1",
    cwd: "/Users/craig/projects/workflowy",
    model: "claude-sonnet-4-6",
    startedAt: 0,
    lastActivity: 0,
    claudeEnv: {},
    tmuxPane: "%1",
    tmuxServerSocket: "/tmp/tmux-501/default",
    herdrPane: "",
    herdrWorkspace: "",
    herdrSocketPath: "",
    ...overrides,
  };
}

describe("parseTmuxPanes", () => {
  it("parses tab-separated pane lines keyed by pane id", () => {
    const stdout = "%1\tmain\t0\teditor\t1\n%2\tmain\t3\tserver name\t0\n";
    const panes = parseTmuxPanes(stdout);
    expect(panes.get("%1")).toStrictEqual({
      paneId: "%1",
      windowIndex: 0,
      windowName: "editor",
      windowActive: true,
    });
    expect(panes.get("%2")).toStrictEqual({
      paneId: "%2",
      windowIndex: 3,
      windowName: "server name",
      windowActive: false,
    });
  });

  it("dedups grouped sessions by pane id (first wins)", () => {
    const stdout = "%5\tmain\t2\twork\t1\n%5\tmain-grouped-10\t2\twork\t1\n";
    const panes = parseTmuxPanes(stdout);
    expect(panes.size).toBe(1);
    expect(panes.get("%5")?.windowIndex).toBe(2);
  });

  it("skips blank and malformed lines", () => {
    const stdout = "\n%1\tmain\tnotanumber\tx\t1\n%2\tmain\t4\ty\t0\n";
    const panes = parseTmuxPanes(stdout);
    expect([...panes.keys()]).toStrictEqual(["%2"]);
  });
});

describe("getTmuxWindows", () => {
  it("joins store entries to tmux panes by pane id", async () => {
    const entries = [
      entry({ sessionId: "sA", tmuxPane: "%1" }),
      entry({ sessionId: "sB", tmuxPane: "%2", cwd: "/Users/craig/projects/foo" }),
    ];
    const runTmux = async () =>
      "%1\tmain\t0\teditor\t1\n%2\tmain\t2\tbuild\t0\n%9\tmain\t5\tother\t0\n";

    const windows = await getTmuxWindows(entries, runTmux);
    const expected: TmuxWindow[] = [
      {
        sessionId: "sA",
        projectName: "workflowy",
        windowIndex: 0,
        windowName: "editor",
        windowActive: true,
        tmuxPane: "%1",
        socket: "/tmp/tmux-501/default",
      },
      {
        sessionId: "sB",
        projectName: "foo",
        windowIndex: 2,
        windowName: "build",
        windowActive: false,
        tmuxPane: "%2",
        socket: "/tmp/tmux-501/default",
      },
    ];
    expect(windows).toStrictEqual(expected);
  });

  it("sorts by window index", async () => {
    const entries = [
      entry({ sessionId: "sA", tmuxPane: "%1" }),
      entry({ sessionId: "sB", tmuxPane: "%2" }),
    ];
    const runTmux = async () => "%1\tmain\t7\ta\t0\n%2\tmain\t3\tb\t0\n";
    const windows = await getTmuxWindows(entries, runTmux);
    expect(windows.map((w) => w.windowIndex)).toStrictEqual([3, 7]);
  });

  it("ignores entries without a pane or socket", async () => {
    const entries = [
      entry({ sessionId: "sA", tmuxPane: "", tmuxServerSocket: "" }),
      entry({ sessionId: "sB", tmuxPane: "%2", tmuxServerSocket: "" }),
      entry({ sessionId: "sC", tmuxPane: "%3" }),
    ];
    const runTmux = async () => "%3\tmain\t1\tc\t1\n";
    const windows = await getTmuxWindows(entries, runTmux);
    expect(windows.map((w) => w.sessionId)).toStrictEqual(["sC"]);
  });

  it("emits only matched panes", async () => {
    const entries = [entry({ sessionId: "sA", tmuxPane: "%missing" })];
    const runTmux = async () => "%1\tmain\t0\tx\t1\n";
    const windows = await getTmuxWindows(entries, runTmux);
    expect(windows).toStrictEqual([]);
  });

  it("collapses multiple entries mapping to the same pane", async () => {
    const entries = [
      entry({ sessionId: "sA", tmuxPane: "%1" }),
      entry({ sessionId: "sB", tmuxPane: "%1" }),
    ];
    const runTmux = async () => "%1\tmain\t0\tx\t1\n";
    const windows = await getTmuxWindows(entries, runTmux);
    expect(windows.map((w) => w.sessionId)).toStrictEqual(["sA"]);
  });

  it("groups by socket and runs tmux per socket", async () => {
    const entries = [
      entry({ sessionId: "sA", tmuxPane: "%1", tmuxServerSocket: "/tmp/sock-a" }),
      entry({ sessionId: "sB", tmuxPane: "%1", tmuxServerSocket: "/tmp/sock-b" }),
    ];
    const seen: string[] = [];
    const runTmux = async (socket: string) => {
      seen.push(socket);
      return "%1\tmain\t0\tx\t1\n";
    };
    const windows = await getTmuxWindows(entries, runTmux);
    expect(seen.sort()).toStrictEqual(["/tmp/sock-a", "/tmp/sock-b"]);
    expect(windows.map((w) => w.socket).sort()).toStrictEqual(["/tmp/sock-a", "/tmp/sock-b"]);
  });

  it("drops only the failing socket's windows on tmux failure", async () => {
    const entries = [
      entry({ sessionId: "sA", tmuxPane: "%1", tmuxServerSocket: "/tmp/sock-a" }),
      entry({ sessionId: "sB", tmuxPane: "%1", tmuxServerSocket: "/tmp/sock-b" }),
    ];
    const runTmux = async (socket: string) => {
      if (socket === "/tmp/sock-a") throw new Error("no server running");
      return "%1\tmain\t0\tx\t1\n";
    };
    const windows = await getTmuxWindows(entries, runTmux);
    expect(windows.map((w) => w.sessionId)).toStrictEqual(["sB"]);
  });

  it("returns [] when there are no tmux entries", async () => {
    const windows = await getTmuxWindows([], async () => "");
    expect(windows).toStrictEqual([]);
  });
});
