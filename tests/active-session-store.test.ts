import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  getActiveSessionEntry,
  markSessionActive,
  markSessionEnded,
  setSessionState,
  touchSession,
  getActiveSessionEntries,
  isSessionActiveInStore,
  hasAnyActiveSessions,
} from "../src/lib/active-session-store";
import type { ActiveSessionEntry } from "../src/lib/active-session-store";

const TEST_TIMESTAMP = 946_684_800_000;

beforeEach(() => {
  // Clear store between tests
  for (const entry of getActiveSessionEntries()) {
    markSessionEnded(entry.sessionId);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("active-session-store", () => {
  it("tracks a new active session", () => {
    markSessionActive("s1", {
      cwd: "/projects/foo",
      model: "claude-sonnet-4-6",
    });
    expect(isSessionActiveInStore("s1")).toBe(true);
    expect(hasAnyActiveSessions()).toBe(true);

    const entries = getActiveSessionEntries();
    if (entries.length !== 1) throw new Error(`Expected 1 entry, got ${entries.length}`);
    expect(entries[0]!.sessionId).toBe("s1");
    expect(entries[0]!.cwd).toBe("/projects/foo");
    expect(entries[0]!.model).toBe("claude-sonnet-4-6");
    expect(entries[0]!.state).toBe("unknown");
  });

  it("sets state without changing the existing session fields or terminal placement", () => {
    vi.spyOn(Date, "now").mockReturnValue(TEST_TIMESTAMP);
    markSessionActive("session-test-100", {
      cwd: "/tmp/test/alice-project",
      model: "claude-test-model",
      claudeEnv: {
        TMUX_PANE: "%100",
        TMUX: "/tmp/test/tmux/default,100,0",
        HERDR_PANE_ID: "w100:p100",
        HERDR_WORKSPACE_ID: "w100",
        HERDR_SOCKET_PATH: "/tmp/test/herdr.sock",
      },
    });

    setSessionState("session-test-100", "waiting");
    markSessionActive("session-test-100", { cwd: "/tmp/test/bob-project" });
    touchSession("session-test-100");

    expect(getActiveSessionEntry("session-test-100")).toStrictEqual({
      sessionId: "session-test-100",
      state: "waiting",
      cwd: "/tmp/test/bob-project",
      model: "claude-test-model",
      startedAt: TEST_TIMESTAMP,
      lastActivity: TEST_TIMESTAMP,
      claudeEnv: {
        TMUX_PANE: "%100",
        TMUX: "/tmp/test/tmux/default,100,0",
        HERDR_PANE_ID: "w100:p100",
        HERDR_WORKSPACE_ID: "w100",
        HERDR_SOCKET_PATH: "/tmp/test/herdr.sock",
      },
      tmuxPane: "%100",
      tmuxServerSocket: "/tmp/test/tmux/default",
      herdrPane: "w100:p100",
      herdrWorkspace: "w100",
      herdrSocketPath: "/tmp/test/herdr.sock",
    });
  });

  it("normalizes a legacy HMR entry missing state without replacing its other fields", () => {
    vi.spyOn(Date, "now").mockReturnValue(TEST_TIMESTAMP);
    markSessionActive("session-test-100", {
      cwd: "/tmp/test/project",
      model: "claude-test-model",
      claudeEnv: { HERDR_PANE_ID: "w100:p100" },
    });
    const legacyEntry = getActiveSessionEntry("session-test-100");
    if (!legacyEntry) throw new Error("Expected active test session");
    delete (legacyEntry as Partial<ActiveSessionEntry>).state;

    const normalizedEntry = getActiveSessionEntry("session-test-100");

    expect(normalizedEntry).toBe(legacyEntry);
    expect(normalizedEntry).toStrictEqual({
      sessionId: "session-test-100",
      state: "unknown",
      cwd: "/tmp/test/project",
      model: "claude-test-model",
      startedAt: TEST_TIMESTAMP,
      lastActivity: TEST_TIMESTAMP,
      claudeEnv: { HERDR_PANE_ID: "w100:p100" },
      tmuxPane: "",
      tmuxServerSocket: "",
      herdrPane: "w100:p100",
      herdrWorkspace: "",
      herdrSocketPath: "",
    });
  });

  it("setting state on an unknown session is a no-op", () => {
    setSessionState("session-test-unknown", "working");
    expect(getActiveSessionEntries()).toStrictEqual([]);
  });

  it("removes a session on end", () => {
    markSessionActive("s1", { cwd: "/projects/foo" });
    markSessionEnded("s1");
    expect(isSessionActiveInStore("s1")).toBe(false);
    expect(hasAnyActiveSessions()).toBe(false);
  });

  it("updates lastActivity on touch", () => {
    markSessionActive("s1", { cwd: "/projects/foo" });
    const before = getActiveSessionEntries()[0]!.lastActivity;
    // small delay to ensure timestamp changes
    touchSession("s1");
    const after = getActiveSessionEntries()[0]!.lastActivity;
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it("updates cwd when marking active again", () => {
    markSessionActive("s1", { cwd: "/projects/foo" });
    markSessionActive("s1", { cwd: "/projects/bar" });
    expect(getActiveSessionEntries().map((e) => e.cwd)).toStrictEqual(["/projects/bar"]);
  });

  it("tracks multiple sessions", () => {
    markSessionActive("s1", { cwd: "/projects/foo" });
    markSessionActive("s2", { cwd: "/projects/bar" });
    expect(getActiveSessionEntries().map((e) => e.sessionId)).toStrictEqual(["s1", "s2"]);
    markSessionEnded("s1");
    expect(getActiveSessionEntries().map((e) => e.sessionId)).toStrictEqual(["s2"]);
  });

  it("touch on unknown session is a no-op", () => {
    touchSession("nonexistent");
    expect(hasAnyActiveSessions()).toBe(false);
  });

  it("captures tmux pane and server socket from claudeEnv", () => {
    markSessionActive("s1", {
      cwd: "/projects/foo",
      claudeEnv: { TMUX_PANE: "%593", TMUX: "/tmp/tmux-501/default,12345,0" },
    });
    const entry = getActiveSessionEntries()[0]!;
    expect(entry.tmuxPane).toBe("%593");
    expect(entry.tmuxServerSocket).toBe("/tmp/tmux-501/default");
  });

  it("leaves tmux fields empty when claudeEnv lacks TMUX vars", () => {
    markSessionActive("s1", { cwd: "/projects/foo" });
    const entry = getActiveSessionEntries()[0]!;
    expect(entry.tmuxPane).toBe("");
    expect(entry.tmuxServerSocket).toBe("");
  });

  it("captures herdr placement from claudeEnv", () => {
    markSessionActive("s1", {
      cwd: "/projects/foo",
      claudeEnv: {
        HERDR_PANE_ID: "w1:p1",
        HERDR_WORKSPACE_ID: "w1",
        HERDR_SOCKET_PATH: "/tmp/test/herdr.sock",
      },
    });
    const entry = getActiveSessionEntries()[0]!;
    expect({
      herdrPane: entry.herdrPane,
      herdrWorkspace: entry.herdrWorkspace,
      herdrSocketPath: entry.herdrSocketPath,
    }).toStrictEqual({
      herdrPane: "w1:p1",
      herdrWorkspace: "w1",
      herdrSocketPath: "/tmp/test/herdr.sock",
    });
  });

  it("re-stamps tmux fields on touch with claudeEnv", () => {
    markSessionActive("s1", {
      cwd: "/projects/foo",
      claudeEnv: { TMUX_PANE: "%1", TMUX: "/tmp/tmux-501/default,1,0" },
    });
    touchSession("s1", {
      claudeEnv: { TMUX_PANE: "%2", TMUX: "/tmp/tmux-501/default,2,0" },
    });
    const entry = getActiveSessionEntries()[0]!;
    expect(entry.tmuxPane).toBe("%2");
    expect(entry.tmuxServerSocket).toBe("/tmp/tmux-501/default");
  });

  it("preserves tmux fields on touch without claudeEnv", () => {
    markSessionActive("s1", {
      cwd: "/projects/foo",
      claudeEnv: { TMUX_PANE: "%7", TMUX: "/tmp/tmux-501/default,9,0" },
    });
    touchSession("s1");
    const entry = getActiveSessionEntries()[0]!;
    expect(entry.tmuxPane).toBe("%7");
    expect(entry.tmuxServerSocket).toBe("/tmp/tmux-501/default");
  });
});
