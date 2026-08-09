import { and, eq, notInArray } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

type IndexDb = BetterSQLite3Database<typeof schema>;

export interface DurableSessionViewedState {
  currentMessageIndex: number;
  lastViewedMessageIndex: number;
  reviewTargetMessageIndex: number;
  newMessageCount: number;
  viewedInCcp: boolean;
  viewedInHerdr: boolean;
  viewedAnywhere: boolean;
}

interface StoredSessionViewedState {
  lastViewedMessageIndex: number;
  reviewTargetMessageIndex: number;
}

const EMPTY_SESSION_VIEWED_STATE: StoredSessionViewedState = {
  lastViewedMessageIndex: -1,
  reviewTargetMessageIndex: -1,
};

function getStoredSessionViewedState(db: IndexDb, sessionId: string): StoredSessionViewedState {
  return (
    db
      .select({
        lastViewedMessageIndex: schema.sessionViewStates.lastViewedMessageIndex,
        reviewTargetMessageIndex: schema.sessionViewStates.reviewTargetMessageIndex,
      })
      .from(schema.sessionViewStates)
      .where(eq(schema.sessionViewStates.sessionId, sessionId))
      .get() ?? EMPTY_SESSION_VIEWED_STATE
  );
}

function writeSessionViewedState(
  db: IndexDb,
  sessionId: string,
  state: StoredSessionViewedState,
  now: number,
): StoredSessionViewedState {
  db.insert(schema.sessionViewStates)
    .values({ sessionId, ...state, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.sessionViewStates.sessionId,
      set: { ...state, updatedAt: now },
    })
    .run();
  return state;
}

/** Mark the transcript through `messageIndex` reviewed and reset the review target to that point. */
export function markSessionReviewed(
  db: IndexDb,
  sessionId: string,
  messageIndex: number,
  now: number = Date.now(),
): StoredSessionViewedState {
  const stored = getStoredSessionViewedState(db, sessionId);
  const viewedMessageIndex = Math.max(stored.lastViewedMessageIndex, messageIndex);
  return writeSessionViewedState(
    db,
    sessionId,
    {
      lastViewedMessageIndex: viewedMessageIndex,
      reviewTargetMessageIndex: viewedMessageIndex,
    },
    now,
  );
}

/** Raise the review target without discarding the exact transcript position last viewed. */
export function markSessionUnreviewed(
  db: IndexDb,
  sessionId: string,
  messageIndex: number,
  now: number = Date.now(),
): StoredSessionViewedState {
  const stored = getStoredSessionViewedState(db, sessionId);
  db.update(schema.herdrTerminalViewStates)
    .set({ viewed: 0, updatedAt: now })
    .where(eq(schema.herdrTerminalViewStates.sessionId, sessionId))
    .run();
  return writeSessionViewedState(
    db,
    sessionId,
    {
      ...stored,
      reviewTargetMessageIndex: Math.max(messageIndex, stored.lastViewedMessageIndex + 1),
    },
    now,
  );
}

/** A completion creates a review target even when its final JSONL record has not flushed yet. */
export function markSessionCompletionUnreviewed(
  db: IndexDb,
  sessionId: string,
  messageIndex: number,
  now: number = Date.now(),
): StoredSessionViewedState {
  return markSessionUnreviewed(db, sessionId, messageIndex, now);
}

export function linkHerdrTerminalToSession(
  db: IndexDb,
  terminalId: string,
  sessionId: string,
  now: number = Date.now(),
): void {
  db.insert(schema.herdrTerminalViewStates)
    .values({ terminalId, sessionId, viewed: 0, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.herdrTerminalViewStates.terminalId,
      set: { sessionId, updatedAt: now },
    })
    .run();
}

export function setHerdrTerminalViewed(
  db: IndexDb,
  terminalId: string,
  sessionId: string,
  viewed: boolean,
  now: number = Date.now(),
): void {
  db.insert(schema.herdrTerminalViewStates)
    .values({ terminalId, sessionId, viewed: viewed ? 1 : 0, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.herdrTerminalViewStates.terminalId,
      set: { sessionId, viewed: viewed ? 1 : 0, updatedAt: now },
    })
    .run();
}

export function pruneHerdrTerminalLinks(
  db: IndexDb,
  sessionId: string,
  activeTerminalIds: string[],
): void {
  if (activeTerminalIds.length === 0) return;
  db.delete(schema.herdrTerminalViewStates)
    .where(
      and(
        eq(schema.herdrTerminalViewStates.sessionId, sessionId),
        notInArray(schema.herdrTerminalViewStates.terminalId, activeTerminalIds),
      ),
    )
    .run();
}

export function getSessionViewedState(
  db: IndexDb,
  sessionId: string,
  currentMessageIndex: number,
): DurableSessionViewedState {
  const stored = getStoredSessionViewedState(db, sessionId);
  const terminalRows = db
    .select({ viewed: schema.herdrTerminalViewStates.viewed })
    .from(schema.herdrTerminalViewStates)
    .where(eq(schema.herdrTerminalViewStates.sessionId, sessionId))
    .all();
  const viewedInCcp = stored.lastViewedMessageIndex >= stored.reviewTargetMessageIndex;
  const viewedInHerdr = terminalRows.some((row) => row.viewed === 1);

  // Derived from the same counter as messageCount (currentMessageIndex is
  // messageCount - 1), and clamped so "N new" can never exceed the total.
  const totalMessages = currentMessageIndex + 1;
  return {
    currentMessageIndex,
    ...stored,
    newMessageCount: Math.min(
      totalMessages,
      Math.max(0, currentMessageIndex - stored.lastViewedMessageIndex),
    ),
    viewedInCcp,
    viewedInHerdr,
    viewedAnywhere: viewedInCcp || viewedInHerdr,
  };
}

/**
 * Return the index of the last message in the session, in the same units as
 * `sessions.message_count` (see message-count.ts). The indexer keeps that
 * column current before SSE broadcasts, so this needs no transcript read.
 */
export function getCurrentSessionMessageIndex(db: IndexDb, sessionId: string): number {
  const row = db
    .select({ messageCount: schema.sessions.messageCount })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .get();
  if (!row) return -1;
  return row.messageCount - 1;
}
