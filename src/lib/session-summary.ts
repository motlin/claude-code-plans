import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import * as schema from "./db/schema";
import { getActiveSessionEntry, type ActiveSessionEntry } from "./active-session-store";
import { getPendingApprovalsForProject } from "./db/pending-approvals-cache";
import type { ActiveSessionPayload, SessionSummaryPayload } from "./hook-events";
import type { SessionEntry } from "./sessions";

type IndexDb = BetterSQLite3Database<typeof schema>;

/**
 * Convert an in-memory ActiveSessionEntry into the wire-level payload shape
 * broadcast on `session:started`. Both shapes are already structurally
 * identical — this helper exists so callers don't depend on that detail.
 */
export function toActiveSessionPayload(entry: ActiveSessionEntry): ActiveSessionPayload {
  return {
    sessionId: entry.sessionId,
    cwd: entry.cwd,
    model: entry.model,
    startedAt: entry.startedAt,
    lastActivity: entry.lastActivity,
  };
}

/**
 * Convert a raw DB SessionEntry into the serialized SessionSummaryPayload
 * shape used by `/api/sessions` and the session:added/updated/removed events.
 */
export function toSessionSummaryPayload(
  entry: SessionEntry,
  starred: boolean,
): SessionSummaryPayload {
  const pendingApproval = getPendingApprovalsForProject(entry.project).find(
    (approval) => approval.sessionId === entry.id,
  );
  const activeState = getActiveSessionEntry(entry.id)?.state ?? "unknown";

  return {
    id: entry.id,
    title: entry.title,
    summary: entry.summary,
    mtime: entry.mtime.toISOString(),
    created: entry.created.toISOString(),
    project: entry.project,
    projectName: entry.projectName,
    messageCount: entry.messageCount,
    gitBranch: entry.gitBranch,
    starred,
    // Transcript-derived approvals survive server restarts, unlike activeState.
    state: pendingApproval ? "waiting" : activeState,
    blockedSince: pendingApproval?.blockedSince ?? null,
  };
}

/**
 * Look up a session by id in the index DB and return the
 * SessionSummaryPayload shape that hook broadcasts use. Returns null when the
 * session has not yet been indexed (e.g., brand new session whose sessions-index.json
 * update has not hit disk yet).
 */
export function buildSessionSummaryPayloadFromDb(
  db: IndexDb,
  sessionId: string,
): SessionSummaryPayload | null {
  const row = db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get();
  if (!row) return null;

  const projectRow = db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, row.projectId))
    .get();
  const projectName = projectRow?.name ?? row.projectId;

  const starredRow = db
    .select()
    .from(schema.starredSessions)
    .where(eq(schema.starredSessions.sessionId, sessionId))
    .get();

  return toSessionSummaryPayload(
    {
      id: row.id,
      title: row.title,
      firstPrompt: row.firstPrompt ?? undefined,
      summary: row.summary ?? undefined,
      customTitle: row.customTitle ?? undefined,
      mtime: new Date(row.mtimeMs),
      created: new Date(row.createdAt),
      project: row.projectId,
      projectName,
      messageCount: row.messageCount,
      gitBranch: row.gitBranch ?? undefined,
      isSidechain: row.isSidechain === 1,
    },
    !!starredRow,
  );
}
