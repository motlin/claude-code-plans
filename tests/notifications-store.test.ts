import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { openTestDb, type AppDb } from "../src/lib/db/connection";
import * as schema from "../src/lib/db/schema";
import { DOMAIN_EVENTS } from "../src/lib/hook-events";
import {
  addNotification,
  clearAllNotifications,
  clearNotificationsForSession,
  dismissNotification,
  getNotifications,
  getNotificationsForProject,
  isNotificationUnread,
  markAllNotificationsRead,
  sweepNotifications,
  type NotificationEntry,
} from "../src/lib/notifications-store";

/**
 * Tests for the in-memory notifications store. The store is a module-level Map,
 * so `clearAllNotifications()` resets it between tests (see beforeEach). We spy
 * on `broadcastTyped` from `src/lib/sse-broadcast` to assert the exact SSE
 * deltas emitted on add / dismiss / clear-all. Project name resolution is
 * exercised against a seeded `openTestDb` so the `sessions`→`projects` join has
 * real rows to resolve; the fallback path uses `basename(cwd)` for an unindexed
 * session. Timestamps are injected directly into `NotificationEntry` values for
 * the TTL sweep (no real `Date.now`/sleep), per the project test-data guidance.
 */

const broadcastSpy = vi.fn();

vi.mock("../src/lib/sse-broadcast", () => ({
  broadcastTyped: (...args: unknown[]) => broadcastSpy(...args),
}));

const PROJECT_ID = "-Users-craig-projects-app";
const PROJECT_NAME = "app";

let db: AppDb;

function seedProject(): void {
  db.index
    .insert(schema.projects)
    .values({
      id: PROJECT_ID,
      name: PROJECT_NAME,
      projectPath: "/Users/craig/projects/app",
      updatedAt: 1,
    })
    .run();
}

function seedSession(sessionId: string): void {
  db.index
    .insert(schema.sessions)
    .values({
      id: sessionId,
      projectId: PROJECT_ID,
      title: sessionId,
      firstPrompt: null,
      summary: null,
      customTitle: null,
      messageCount: 0,
      gitBranch: null,
      cwd: null,
      isSidechain: 0,
      createdAt: 1,
      mtimeMs: 1,
      filePath: `/Users/craig/.claude/projects/${PROJECT_ID}/${sessionId}.jsonl`,
    })
    .run();
}

function makeEntry(overrides: Partial<NotificationEntry> & { id: string }): NotificationEntry {
  const createdAt = overrides.createdAt ?? Date.now();
  return {
    id: overrides.id,
    sessionId: overrides.sessionId ?? "sess-1",
    projectId: overrides.projectId ?? PROJECT_ID,
    projectName: overrides.projectName ?? PROJECT_NAME,
    message: overrides.message ?? "Agent needs your input",
    notificationType: overrides.notificationType ?? "agent_needs_input",
    createdAt,
    createdAtIso: overrides.createdAtIso ?? new Date(createdAt).toISOString(),
    ...(overrides.title !== undefined ? { title: overrides.title } : {}),
  };
}

beforeEach(() => {
  db = openTestDb();
  clearAllNotifications();
  broadcastSpy.mockReset();
});

afterEach(() => {
  clearAllNotifications();
  db.close();
});

describe("addNotification", () => {
  it("resolves project name from a seeded session and returns the entry via getNotifications", () => {
    seedProject();
    seedSession("sess-1");

    const entry = addNotification(db.index, {
      sessionId: "sess-1",
      cwd: "/Users/craig/projects/app",
      message: "Agent needs your input",
      title: "Claude Code",
      notificationType: "agent_needs_input",
    });

    expect(entry.projectId).toBe(PROJECT_ID);
    expect(entry.projectName).toBe(PROJECT_NAME);

    const all = getNotifications();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      id: entry.id,
      sessionId: "sess-1",
      projectId: PROJECT_ID,
      projectName: PROJECT_NAME,
      message: "Agent needs your input",
      title: "Claude Code",
      notificationType: "agent_needs_input",
    });
    expect(typeof all[0]!.createdAt).toBe("number");
    expect(all[0]!.createdAtIso).toBe(new Date(all[0]!.createdAt).toISOString());
  });

  it("falls back to basename(cwd) for both project fields when the session is not indexed", () => {
    const entry = addNotification(db.index, {
      sessionId: "unindexed",
      cwd: "/tmp/my-project",
      message: "Waiting for input",
      notificationType: "",
    });

    expect(entry.projectId).toBe("my-project");
    expect(entry.projectName).toBe("my-project");
    // No title supplied → absent, not `undefined`, per exactOptionalPropertyTypes.
    expect("title" in entry).toBe(false);
  });

  it("broadcasts NOTIFICATION_ADDED with the resolved projectName", () => {
    seedProject();
    seedSession("sess-1");

    const entry = addNotification(db.index, {
      sessionId: "sess-1",
      cwd: "/Users/craig/projects/app",
      message: "Agent needs your input",
      notificationType: "agent_needs_input",
    });

    const addedCalls = broadcastSpy.mock.calls.filter(
      (c) => c[0] === DOMAIN_EVENTS.NOTIFICATION_ADDED,
    );
    expect(addedCalls).toHaveLength(1);
    const payload = addedCalls[0]![1] as {
      notification: { id: string; projectName: string };
    };
    expect(payload.notification.id).toBe(entry.id);
    expect(payload.notification.projectName).toBe(PROJECT_NAME);
  });

  it("evicts the oldest entry once MAX_ENTRIES (200) is exceeded", () => {
    const firstId = addNotification(db.index, {
      sessionId: "sess-first",
      cwd: "/tmp/app",
      message: "first",
      notificationType: "agent_needs_input",
    }).id;

    // Add 200 more so the store overflows its 200-entry cap by one.
    for (let i = 0; i < 200; i++) {
      addNotification(db.index, {
        sessionId: `sess-${i}`,
        cwd: "/tmp/app",
        message: `msg-${i}`,
        notificationType: "agent_needs_input",
      });
    }

    const all = getNotifications();
    expect(all).toHaveLength(200);
    // The very first (oldest) entry was evicted; the newest survive.
    expect(all.some((n) => n.id === firstId)).toBe(false);
  });
});

describe("supersede per session", () => {
  it("collapses two consecutive notifications for one session into the latest", () => {
    const first = addNotification(db.index, {
      sessionId: "sess-1",
      cwd: "/tmp/app",
      message: "Claude is waiting for your input",
      notificationType: "agent_needs_input",
    });
    broadcastSpy.mockReset();
    const second = addNotification(db.index, {
      sessionId: "sess-1",
      cwd: "/tmp/app",
      message: "Claude needs your permission",
      notificationType: "agent_needs_input",
    });

    const all = getNotifications();
    expect(all).toHaveLength(1);
    expect(all[0]!.id).toBe(second.id);
    expect(all[0]!.message).toBe("Claude needs your permission");

    // The stale entry is broadcast as cleared so live clients drop it.
    const clearedCalls = broadcastSpy.mock.calls.filter(
      (c) => c[0] === DOMAIN_EVENTS.NOTIFICATION_CLEARED,
    );
    expect(clearedCalls).toHaveLength(1);
    expect(clearedCalls[0]![1]).toStrictEqual({ id: first.id });
  });

  it("does not touch other sessions' entries", () => {
    const other = addNotification(db.index, {
      sessionId: "sess-other",
      cwd: "/tmp/app",
      message: "other session",
      notificationType: "agent_needs_input",
    });
    addNotification(db.index, {
      sessionId: "sess-1",
      cwd: "/tmp/app",
      message: "first",
      notificationType: "agent_needs_input",
    });
    addNotification(db.index, {
      sessionId: "sess-1",
      cwd: "/tmp/app",
      message: "second",
      notificationType: "agent_needs_input",
    });

    const all = getNotifications();
    expect(all.map((n) => n.message).sort()).toStrictEqual(["other session", "second"]);
    expect(all.some((n) => n.id === other.id)).toBe(true);
  });
});

describe("clearNotificationsForSession", () => {
  it("removes only the session's entries and broadcasts NOTIFICATION_CLEARED per id", () => {
    const target = addNotification(db.index, {
      sessionId: "sess-1",
      cwd: "/tmp/app",
      message: "waiting",
      notificationType: "agent_needs_input",
    });
    const other = addNotification(db.index, {
      sessionId: "sess-2",
      cwd: "/tmp/app",
      message: "other",
      notificationType: "agent_needs_input",
    });
    broadcastSpy.mockReset();

    clearNotificationsForSession("sess-1");

    const all = getNotifications();
    expect(all).toHaveLength(1);
    expect(all[0]!.id).toBe(other.id);
    const clearedCalls = broadcastSpy.mock.calls.filter(
      (c) => c[0] === DOMAIN_EVENTS.NOTIFICATION_CLEARED,
    );
    expect(clearedCalls).toHaveLength(1);
    expect(clearedCalls[0]![1]).toStrictEqual({ id: target.id });
  });

  it("does not broadcast when the session has no entries", () => {
    clearNotificationsForSession("no-such-session");
    expect(
      broadcastSpy.mock.calls.filter((c) => c[0] === DOMAIN_EVENTS.NOTIFICATION_CLEARED),
    ).toHaveLength(0);
  });
});

describe("read state", () => {
  it("viewing marks existing entries read; later arrivals are unread again", () => {
    const first = addNotification(db.index, {
      sessionId: "sess-1",
      cwd: "/tmp/app",
      message: "waiting",
      notificationType: "agent_needs_input",
    });
    expect(isNotificationUnread(first.id)).toBe(true);

    markAllNotificationsRead();
    expect(isNotificationUnread(first.id)).toBe(false);

    const second = addNotification(db.index, {
      sessionId: "sess-2",
      cwd: "/tmp/app",
      message: "new arrival",
      notificationType: "agent_needs_input",
    });
    expect(isNotificationUnread(second.id)).toBe(true);
    expect(isNotificationUnread(first.id)).toBe(false);
  });

  it("clearAllNotifications resets read state so a re-added entry is unread", () => {
    const entry = addNotification(db.index, {
      sessionId: "sess-1",
      cwd: "/tmp/app",
      message: "waiting",
      notificationType: "agent_needs_input",
    });
    markAllNotificationsRead();
    clearAllNotifications();
    expect(isNotificationUnread(entry.id)).toBe(true);
  });
});

describe("getNotificationsForProject", () => {
  it("returns only the entries for the requested project, newest-first", () => {
    seedProject();
    seedSession("sess-1");

    addNotification(db.index, {
      sessionId: "sess-1",
      cwd: "/Users/craig/projects/app",
      message: "in-project",
      notificationType: "agent_needs_input",
    });
    addNotification(db.index, {
      sessionId: "other-session",
      cwd: "/tmp/other-project",
      message: "other-project",
      notificationType: "agent_completed",
    });

    const scoped = getNotificationsForProject(PROJECT_ID);
    expect(scoped).toHaveLength(1);
    expect(scoped[0]?.message).toBe("in-project");

    expect(getNotificationsForProject("other-project")).toHaveLength(1);
    expect(getNotificationsForProject("no-such-project")).toHaveLength(0);
  });
});

describe("dismissNotification", () => {
  it("removes the entry and broadcasts NOTIFICATION_CLEARED with its id", () => {
    const entry = addNotification(db.index, {
      sessionId: "sess-1",
      cwd: "/tmp/app",
      message: "dismiss me",
      notificationType: "agent_needs_input",
    });
    broadcastSpy.mockReset();

    dismissNotification(entry.id);

    expect(getNotifications().some((n) => n.id === entry.id)).toBe(false);
    const clearedCalls = broadcastSpy.mock.calls.filter(
      (c) => c[0] === DOMAIN_EVENTS.NOTIFICATION_CLEARED,
    );
    expect(clearedCalls).toHaveLength(1);
    expect(clearedCalls[0]![1]).toStrictEqual({ id: entry.id });
  });

  it("does not broadcast when the id is not present", () => {
    dismissNotification("nonexistent");
    expect(
      broadcastSpy.mock.calls.filter((c) => c[0] === DOMAIN_EVENTS.NOTIFICATION_CLEARED),
    ).toHaveLength(0);
  });
});

describe("clearAllNotifications", () => {
  it("empties the store and broadcasts NOTIFICATION_CLEARED with all:true", () => {
    addNotification(db.index, {
      sessionId: "sess-1",
      cwd: "/tmp/app",
      message: "one",
      notificationType: "agent_needs_input",
    });
    addNotification(db.index, {
      sessionId: "sess-2",
      cwd: "/tmp/app",
      message: "two",
      notificationType: "agent_completed",
    });
    broadcastSpy.mockReset();

    clearAllNotifications();

    expect(getNotifications()).toHaveLength(0);
    const clearedCalls = broadcastSpy.mock.calls.filter(
      (c) => c[0] === DOMAIN_EVENTS.NOTIFICATION_CLEARED,
    );
    expect(clearedCalls).toHaveLength(1);
    expect(clearedCalls[0]![1]).toStrictEqual({ all: true });
  });
});

describe("sweepNotifications", () => {
  it("drops entries older than the 24h TTL and keeps fresh ones", () => {
    const now = Date.now();
    const target = new Map<string, NotificationEntry>();
    target.set("stale", makeEntry({ id: "stale", createdAt: now - 25 * 60 * 60 * 1000 }));
    target.set("fresh", makeEntry({ id: "fresh", createdAt: now }));

    sweepNotifications(target);

    expect(target.size).toBe(1);
    expect(target.has("stale")).toBe(false);
    expect(target.has("fresh")).toBe(true);
  });
});
