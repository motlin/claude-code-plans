import { statSync } from "node:fs";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import * as schema from "./schema";
import {
  scanAllPendingApprovals,
  scanPendingApproval,
  type PendingApproval,
} from "../pending-approvals";
import { getPlanFilenameForSession } from "./queries";
import { DOMAIN_EVENTS } from "../hook-events";
import { broadcastTyped } from "../sse-broadcast";

type IndexDb = BetterSQLite3Database<typeof schema>;

interface CacheEntry {
  approval: PendingApproval;
  filePath: string | null;
  /** mtime of filePath sampled immediately *before* the scan that produced `approval`. */
  mtimeMs: number;
}

const cache = new Map<string, CacheEntry>();
const expiredThroughBySession = new Map<string, string>();
let revalidation: Promise<void> | null = null;

function approvalsEqual(a: PendingApproval, b: PendingApproval): boolean {
  return (
    a.sessionId === b.sessionId &&
    a.projectId === b.projectId &&
    a.projectName === b.projectName &&
    a.toolName === b.toolName &&
    a.toolUseId === b.toolUseId &&
    a.blockedSince === b.blockedSince &&
    a.planFilename === b.planFilename &&
    a.questionPreview === b.questionPreview
  );
}

function lookupProjectName(db: IndexDb, projectId: string): string {
  const row = db
    .select({ name: schema.projects.name })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .get();
  return row?.name ?? projectId;
}

function lookupSessionFilePath(db: IndexDb, sessionId: string): string | null {
  const row = db
    .select({ filePath: schema.sessions.filePath })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .get();
  return row?.filePath ?? null;
}

/** mtime of `filePath`, or null when it cannot be stat'd (deleted, permissions). */
function statMtimeMs(filePath: string): number | null {
  try {
    return statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
}

export async function initPendingApprovalsCache(db: IndexDb): Promise<void> {
  cache.clear();
  expiredThroughBySession.clear();
  const approvals = await scanAllPendingApprovals(db);
  for (const approval of approvals) {
    const filePath = lookupSessionFilePath(db, approval.sessionId);
    cache.set(approval.sessionId, {
      approval,
      filePath,
      mtimeMs: filePath === null ? 0 : (statMtimeMs(filePath) ?? 0),
    });
  }
}

export function getPendingApprovals(): PendingApproval[] {
  return Array.from(cache.values(), (entry) => entry.approval).sort((a, b) =>
    a.blockedSince.localeCompare(b.blockedSince),
  );
}

export function getPendingApprovalsForProject(projectId: string): PendingApproval[] {
  return getPendingApprovals().filter((a) => a.projectId === projectId);
}

export async function updatePendingApprovalForSession(
  db: IndexDb,
  sessionId: string,
  filePath: string,
  projectId: string,
  projectName?: string,
): Promise<void> {
  // Sample the mtime before reading: a write that races the scan leaves an mtime
  // newer than the one recorded, so revalidation rescans instead of trusting it.
  const mtimeMs = statMtimeMs(filePath) ?? 0;
  const scanned = await scanPendingApproval(filePath);
  const prior = cache.get(sessionId);

  if (!scanned) {
    if (prior) {
      cache.delete(sessionId);
      broadcastTyped(DOMAIN_EVENTS.APPROVAL_RESOLVED, { sessionId });
    }
    return;
  }

  const expiredThrough = expiredThroughBySession.get(sessionId);
  if (expiredThrough !== undefined && scanned.blockedSince <= expiredThrough) {
    return;
  }

  const resolvedProjectName = projectName ?? lookupProjectName(db, projectId);
  const planFilename = scanned.planFilename ?? getPlanFilenameForSession(db, sessionId);

  const approval: PendingApproval = {
    sessionId,
    projectId,
    projectName: resolvedProjectName,
    toolName: scanned.toolName,
    toolUseId: scanned.toolUseId,
    blockedSince: scanned.blockedSince,
    planFilename,
    questionPreview: scanned.questionPreview,
  };

  if (prior && approvalsEqual(prior.approval, approval)) {
    cache.set(sessionId, { approval: prior.approval, filePath, mtimeMs });
    return;
  }

  cache.set(sessionId, { approval, filePath, mtimeMs });
  broadcastTyped(DOMAIN_EVENTS.APPROVAL_CHANGED, { approval });
}

/**
 * Re-check every cached approval against its transcript on disk.
 *
 * The cache is otherwise only advanced by watcher events and hook events, so a
 * single dropped filesystem event strands an already-answered approval as
 * pending forever (and hooks are optional, so that path may not exist at all).
 * Read paths call this so the pending state heals itself: any entry whose file
 * has changed since it was scanned is rescanned, and any entry whose file is
 * gone is dropped. Concurrent calls share one pass.
 */
export function revalidatePendingApprovals(db: IndexDb): Promise<void> {
  revalidation ??= runRevalidation(db).finally(() => {
    revalidation = null;
  });
  return revalidation;
}

async function runRevalidation(db: IndexDb): Promise<void> {
  for (const [sessionId, entry] of [...cache]) {
    const filePath = entry.filePath ?? lookupSessionFilePath(db, sessionId);
    if (filePath === null) continue;

    const mtimeMs = statMtimeMs(filePath);
    if (mtimeMs === null) {
      removePendingApprovalForSession(sessionId);
      continue;
    }
    if (mtimeMs <= entry.mtimeMs) continue;

    await updatePendingApprovalForSession(
      db,
      sessionId,
      filePath,
      entry.approval.projectId,
      entry.approval.projectName,
    );
  }
}

export function removePendingApprovalForSession(sessionId: string): void {
  if (!cache.has(sessionId)) return;
  cache.delete(sessionId);
  broadcastTyped(DOMAIN_EVENTS.APPROVAL_RESOLVED, { sessionId });
}

export function expirePendingApprovalForSession(sessionId: string): void {
  expiredThroughBySession.set(sessionId, new Date().toISOString());
  removePendingApprovalForSession(sessionId);
}

export function resumePendingApprovalsForSession(sessionId: string): void {
  expiredThroughBySession.delete(sessionId);
}
