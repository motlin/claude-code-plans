import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import * as schema from "./db/schema";
import { DOMAIN_EVENTS } from "./hook-events";
import type { NotificationEntryPayload } from "./hook-events";
import { broadcastTyped } from "./sse-broadcast";
import { hmrPersist, hmrDispose } from "./hmr-persist";

type IndexDb = BetterSQLite3Database<typeof schema>;

/**
 * A single persisted notification originating from a `Notification` hook POST.
 * Mirrors `NotificationEntryPayload`; `title` follows `exactOptionalPropertyTypes`
 * (absent, not `undefined`, when the hook carried no title). `notificationType`
 * is the freeform discriminator (`agent_needs_input` / `agent_completed` /
 * unknown) classified in the presentation layer.
 */
export interface NotificationEntry {
  id: string;
  sessionId: string;
  projectId: string;
  projectName: string;
  message: string;
  title?: string;
  notificationType: string;
  createdAt: number;
  createdAtIso: string;
}

/**
 * Keyed by generated `id` (many notifications coexist per session). HMR-persisted
 * so live entries survive dev hot-swaps, exactly like the active-session store.
 * Not backed by a DB table: a notification lands nowhere on disk and could never
 * be rebuilt by rescanning `~/.claude`, so it must not live in the rebuildable
 * index cache.
 */
const store = hmrPersist("notificationsStore", () => new Map<string, NotificationEntry>());

let sweepTimer: ReturnType<typeof setInterval> | null = null;

hmrDispose(() => {
  if (sweepTimer) clearInterval(sweepTimer);
});

const MAX_ENTRIES = 200;
const NOTIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const NOTIFICATIONS_SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Resolve a session's project via the same `sessions`→`projects` join the
 * approvals cache uses. Falls back to `basename(cwd)` for both fields when the
 * session is not yet indexed (the hook can arrive before the JSONL is scanned).
 */
function resolveProject(
  db: IndexDb,
  sessionId: string,
  cwd: string,
): { projectId: string; projectName: string } {
  const row = db
    .select({ projectId: schema.sessions.projectId, projectName: schema.projects.name })
    .from(schema.sessions)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.sessions.projectId))
    .where(eq(schema.sessions.id, sessionId))
    .get();
  if (row) {
    return { projectId: row.projectId, projectName: row.projectName };
  }
  const fallback = basename(cwd);
  return { projectId: fallback, projectName: fallback };
}

function toPayload(entry: NotificationEntry): NotificationEntryPayload {
  return {
    id: entry.id,
    sessionId: entry.sessionId,
    projectId: entry.projectId,
    projectName: entry.projectName,
    message: entry.message,
    title: entry.title,
    notificationType: entry.notificationType,
    createdAt: entry.createdAt,
    createdAtIso: entry.createdAtIso,
  };
}

/**
 * Evict oldest entries until the store is within `MAX_ENTRIES`. Entries are
 * inserted in monotonic `createdAt` order and never re-keyed, so Map insertion
 * order is age order and the first key is always the oldest — FIFO eviction
 * (same idiom as the markdown promise cache), no per-insert scan.
 */
function enforceMaxEntries(): void {
  while (store.size > MAX_ENTRIES) {
    const oldestId = store.keys().next().value;
    if (oldestId === undefined) break;
    store.delete(oldestId);
  }
}

export function addNotification(
  db: IndexDb,
  input: {
    sessionId: string;
    cwd: string;
    message: string;
    title?: string;
    notificationType: string;
  },
): NotificationEntry {
  const { projectId, projectName } = resolveProject(db, input.sessionId, input.cwd);
  const createdAt = Date.now();
  const entry: NotificationEntry = {
    id: randomUUID(),
    sessionId: input.sessionId,
    projectId,
    projectName,
    message: input.message,
    notificationType: input.notificationType,
    createdAt,
    createdAtIso: new Date(createdAt).toISOString(),
  };
  if (input.title !== undefined) entry.title = input.title;

  store.set(entry.id, entry);
  enforceMaxEntries();
  broadcastTyped(DOMAIN_EVENTS.NOTIFICATION_ADDED, { notification: toPayload(entry) });
  return entry;
}

export function getNotifications(): NotificationEntry[] {
  return [...store.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export function getNotificationsForProject(projectId: string): NotificationEntry[] {
  return getNotifications().filter((entry) => entry.projectId === projectId);
}

export function dismissNotification(id: string): void {
  if (store.delete(id)) {
    broadcastTyped(DOMAIN_EVENTS.NOTIFICATION_CLEARED, { id });
  }
}

export function clearAllNotifications(): void {
  store.clear();
  broadcastTyped(DOMAIN_EVENTS.NOTIFICATION_CLEARED, { all: true });
}

/**
 * Drop entries older than the TTL. Takes the target map (mirrors
 * `sweepSessions`) so a future test could drive it with injected timestamps
 * rather than real `Date.now`/sleep.
 */
function sweepNotifications(target: Map<string, NotificationEntry>): void {
  const cutoff = Date.now() - NOTIFICATION_TTL_MS;
  for (const [id, entry] of target) {
    if (entry.createdAt < cutoff) {
      target.delete(id);
    }
  }
}

function sweep(): void {
  sweepNotifications(store);
}

export function startNotificationsSweep(): void {
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = setInterval(sweep, NOTIFICATIONS_SWEEP_INTERVAL_MS);
}
