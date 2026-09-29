import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import * as schema from "./db/schema";
import { getActiveSessionEntry, type ActiveSessionEntry } from "./active-session-store";
import { getPendingApprovalsForProject } from "./db/pending-approvals-cache";
import { getSessionPrLink, isSessionArchived } from "./db/queries";
import { isSessionUnseen } from "./db/viewed-state";
import type { ActiveSessionPayload, SessionSummaryPayload } from "./hook-events";
import { getLiveSubagentNodes } from "./live-subagent-store";
import type { PrStatus } from "./pr-status";
import { lookupSessionPrStatus } from "./pr-status-service";
import { resolveSessionBucket } from "./session-state";
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

interface SessionSummaryOptions {
  /** The durable viewed-state `unseen` flag (see `getUnseenSessionIds`). */
  unseen?: boolean;
  /** The app-side archive flag (see `getArchivedSessionIds`). */
  archived?: boolean;
  activeSession?: ActiveSessionEntry | null;
  /** PR state for the row; defaults to the in-memory PR status service. */
  prStatus?: PrStatus | null;
  now?: number;
}

/**
 * Convert a raw DB SessionEntry into the serialized SessionSummaryPayload
 * shape used by `/api/sessions` and the session:added/updated/removed events.
 */
export function toSessionSummaryPayload(
  entry: SessionEntry,
  {
    unseen = false,
    archived = false,
    activeSession = getActiveSessionEntry(entry.id),
    prStatus = lookupSessionPrStatus(entry),
    now = Date.now(),
  }: SessionSummaryOptions = {},
): SessionSummaryPayload {
  const pendingApproval = getPendingApprovalsForProject(entry.project).find(
    (approval) => approval.sessionId === entry.id,
  );
  const liveAgentCount = getLiveSubagentNodes().filter(
    (node) => node.sessionId === entry.id && node.endedAt === null,
  ).length;
  // Only active-store entries are live. A missing entry is an ended session,
  // even if a transcript-derived approval has survived a server restart.
  const pendingInput = activeSession !== null && pendingApproval !== undefined;
  const { bucket } = resolveSessionBucket({
    mainState: activeSession?.state ?? "ended",
    pendingInput,
    unseenError: false,
    liveAgentCount,
    backgroundTasks: activeSession?.backgroundTasks ?? [],
    lastSubagentActivityAt: activeSession?.lastSubagentActivityAt ?? null,
    herdrStatus: null,
    prState: prStatus?.state ?? null,
    unseen,
    fileMtime: entry.mtime.getTime(),
    now,
  });
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
    ...(entry.pr === undefined ? {} : { pr: entry.pr }),
    ...(prStatus === null ? {} : { prStatus }),
    ...(entry.forkedFromSessionId === undefined
      ? {}
      : { forkedFromSessionId: entry.forkedFromSessionId }),
    archived,
    state: activeSession === null ? "ended" : pendingInput ? "waiting" : activeSession.state,
    bucket,
    liveAgentCount,
    unseen,
    blockedSince: activeSession === null ? null : (pendingApproval?.blockedSince ?? null),
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
  activeSessionLookup: (sessionId: string) => ActiveSessionEntry | null = getActiveSessionEntry,
): SessionSummaryPayload | null {
  const row = db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get();
  if (!row) return null;

  const projectRow = db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, row.projectId))
    .get();
  const projectName = projectRow?.name ?? row.projectId;

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
      cwd: row.cwd ?? undefined,
      isSidechain: row.isSidechain === 1,
      forkedFromSessionId: row.forkedFromSessionId ?? undefined,
      pr: getSessionPrLink(db, sessionId) ?? undefined,
    },
    {
      unseen: isSessionUnseen(db, sessionId),
      archived: isSessionArchived(db, sessionId),
      activeSession: activeSessionLookup(sessionId),
    },
  );
}
