import { updateSessionViewedState } from "./api/viewed-state";

/**
 * Client-side cache of the server's durable `unseen` flag (see
 * `getUnseenSessionIds` in db/viewed-state.ts). The server is the source of
 * truth: session summaries and SSE `session:updated` events seed this cache,
 * and manual actions update it optimistically before persisting.
 */

type ViewedAction = "reviewed" | "unreviewed";
type Persist = (sessionId: string, action: ViewedAction) => Promise<unknown>;

const listeners = new Set<() => void>();
const unseenBySession = new Map<string, boolean>();

let persist: Persist = (sessionId, action) => updateSessionViewedState(sessionId, action);

function emitChange(): void {
  for (const listener of listeners) listener();
}

function setUnseen(sessionId: string, unseen: boolean): boolean {
  if ((unseenBySession.get(sessionId) ?? false) === unseen) return false;
  unseenBySession.set(sessionId, unseen);
  return true;
}

/** Adopt the server's flag for every summary; notifies subscribers once if anything changed. */
export function syncUnseenFromSummaries(
  summaries: Iterable<{ id: string; unseen: boolean }>,
): void {
  let changed = false;
  for (const summary of summaries) {
    if (setUnseen(summary.id, summary.unseen)) changed = true;
  }
  if (changed) emitChange();
}

function applyOptimistically(sessionId: string, unseen: boolean): void {
  const previous = unseenBySession.get(sessionId) ?? false;
  if (setUnseen(sessionId, unseen)) emitChange();
  void Promise.resolve()
    .then(() => persist(sessionId, unseen ? "unreviewed" : "reviewed"))
    .catch((error: unknown) => {
      console.warn("[unread-store] failed to persist unseen flag", error);
      // Roll back only if nothing (such as an SSE summary) has replaced the optimistic value.
      if (unseenBySession.get(sessionId) === unseen && setUnseen(sessionId, previous)) {
        emitChange();
      }
    });
}

export function markUnseen(sessionId: string): void {
  applyOptimistically(sessionId, true);
}

export function markSeen(sessionId: string): void {
  applyOptimistically(sessionId, false);
}

export function clearAll(): void {
  for (const [sessionId, unseen] of unseenBySession) {
    if (unseen) markSeen(sessionId);
  }
}

export function hasUnseenWork(sessionId: string): boolean {
  return unseenBySession.get(sessionId) === true;
}

export function subscribeUnseenWork(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const __unreadStoreTesting = {
  setPersist(next: Persist): void {
    persist = next;
  },
  reset(): void {
    unseenBySession.clear();
    emitChange();
  },
};
