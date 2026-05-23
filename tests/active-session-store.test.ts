import { describe, expect, it, beforeEach } from "vite-plus/test";
import {
  markSessionActive,
  markSessionEnded,
  touchSession,
  getActiveSessionEntries,
  isSessionActiveInStore,
  hasAnyActiveSessions,
} from "../src/lib/active-session-store";

beforeEach(() => {
  // Clear store between tests
  for (const entry of getActiveSessionEntries()) {
    markSessionEnded(entry.sessionId);
  }
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
});
