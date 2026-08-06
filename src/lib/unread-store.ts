import type { ActivityState, DisplayState } from "./session-state";

const STORAGE_KEY = "ccp-unseen-work";

type UnseenWorkMap = Record<string, true>;

const listeners = new Set<() => void>();
const previousDisplayStates = new Map<string, DisplayState>();

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readUnseenWork(): UnseenWorkMap {
  try {
    const stored = storage()?.getItem(STORAGE_KEY);
    if (stored === null || stored === undefined) return {};
    const parsed: unknown = JSON.parse(stored);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    if (!Object.values(parsed).every((value) => value === true)) return {};
    return parsed as UnseenWorkMap;
  } catch {
    return {};
  }
}

function writeUnseenWork(unseenWork: UnseenWorkMap): void {
  try {
    const localStorage = storage();
    if (!localStorage) return;
    if (Object.keys(unseenWork).length === 0) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(unseenWork));
    }
  } catch {
    // localStorage can be denied even when window exists; the latch is best-effort client state.
  }
}

function emitChange(): void {
  for (const listener of listeners) listener();
}

function persistUnseen(sessionId: string): void {
  const unseenWork = readUnseenWork();
  if (unseenWork[sessionId]) return;
  writeUnseenWork({ ...unseenWork, [sessionId]: true });
  emitChange();
}

/** Record a display-state observation and return the preceding observation. */
function rememberDisplayState(
  sessionId: string,
  displayState: DisplayState,
): DisplayState | undefined {
  const previous = previousDisplayStates.get(sessionId);
  previousDisplayStates.set(sessionId, displayState);
  return previous;
}

export function markUnseen(sessionId: string): void {
  // Seed the notification transition baseline before a manual latch flip. Otherwise the user's
  // own click appears to be a fresh transition into review and notifies them about their action.
  rememberDisplayState(sessionId, "review");
  persistUnseen(sessionId);
}

/** Raise the latch from observed work without suppressing the later transition into review. */
export function observeSessionState(sessionId: string, state: ActivityState): void {
  if (state === "working" || state === "waiting") persistUnseen(sessionId);
}

export function markSeen(sessionId: string): void {
  const unseenWork = readUnseenWork();
  if (!unseenWork[sessionId]) return;
  delete unseenWork[sessionId];
  writeUnseenWork(unseenWork);
  emitChange();
}

export function clearAll(): void {
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    // localStorage can be denied even when window exists; the latch is best-effort client state.
  }
  emitChange();
}

export function hasUnseenWork(sessionId: string): boolean {
  return readUnseenWork()[sessionId] === true;
}

export function subscribeUnseenWork(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const __testing = {
  previousDisplayState(sessionId: string): DisplayState | undefined {
    return previousDisplayStates.get(sessionId);
  },
  resetPreviousDisplayStates(): void {
    previousDisplayStates.clear();
  },
};
