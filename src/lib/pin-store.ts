import { useSyncExternalStore } from "react";
import { z } from "zod";

/**
 * Per-browser session pins, like claude.ai/code: the pin set plus an optional
 * user order. A menu pin joins `pinnedIds` only; drag pins and reorders write
 * `pinnedOrder`. Ordered pins display first, the rest follow the list's Sort by.
 */
export const PIN_STORAGE_KEY = "ccp-pins";

const PinStateSchema = z.strictObject({
  pinnedIds: z.array(z.string()),
  pinnedOrder: z.array(z.string()),
});

export type PinState = z.infer<typeof PinStateSchema>;

const EMPTY_PIN_STATE: PinState = { pinnedIds: [], pinnedOrder: [] };

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedState: PinState = EMPTY_PIN_STATE;

function readRaw(): string | null {
  try {
    return localStorage.getItem(PIN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function parse(raw: string | null): PinState {
  if (raw === null) return EMPTY_PIN_STATE;
  try {
    const result = PinStateSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : EMPTY_PIN_STATE;
  } catch {
    return EMPTY_PIN_STATE;
  }
}

/** Current pins; absent, corrupt or unreadable storage yields no pins. */
export function readPinState(): PinState {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedState = parse(raw);
  }
  return cachedState;
}

function notify(): void {
  for (const listener of listeners) listener();
}

function writePinState(state: PinState): void {
  try {
    localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage can be denied or full; pins are best-effort per browser.
  }
  notify();
}

export function isPinned(id: string): boolean {
  return readPinState().pinnedIds.includes(id);
}

/** Pin a session. With `at`, it is also placed at that index of the user order. */
export function pin(id: string, at?: number): void {
  const state = readPinState();
  const pinnedIds = state.pinnedIds.includes(id) ? state.pinnedIds : [...state.pinnedIds, id];
  let pinnedOrder = state.pinnedOrder;
  if (at !== undefined) {
    pinnedOrder = pinnedOrder.filter((key) => key !== id);
    const index = Math.max(0, Math.min(at, pinnedOrder.length));
    pinnedOrder = [...pinnedOrder.slice(0, index), id, ...pinnedOrder.slice(index)];
  }
  writePinState({ pinnedIds, pinnedOrder });
}

export function unpin(id: string): void {
  const state = readPinState();
  writePinState({
    pinnedIds: state.pinnedIds.filter((key) => key !== id),
    pinnedOrder: state.pinnedOrder.filter((key) => key !== id),
  });
}

/**
 * Move a pinned session in the user order to just before `beforeId`, or to the
 * end of the ordered pins when `beforeId` is null or itself unordered.
 */
export function movePin(id: string, beforeId: string | null): void {
  const state = readPinState();
  if (!state.pinnedIds.includes(id)) return;
  const rest = state.pinnedOrder.filter((key) => key !== id);
  const index = beforeId === null ? -1 : rest.indexOf(beforeId);
  const pinnedOrder =
    index === -1 ? [...rest, id] : [...rest.slice(0, index), id, ...rest.slice(index)];
  writePinState({ pinnedIds: state.pinnedIds, pinnedOrder });
}

/** The pinned subset of `sessions`: user-ordered pins first, then the rest by `sortComparator`. */
export function orderedPins<T extends { id: string }>(
  sessions: readonly T[],
  sortComparator: (a: T, b: T) => number,
  state: PinState = readPinState(),
): T[] {
  const pinned = new Set(state.pinnedIds);
  const orderIndex = new Map(state.pinnedOrder.map((id, index) => [id, index]));
  return sessions
    .filter((session) => pinned.has(session.id))
    .sort((a, b) => {
      const aIndex = orderIndex.get(a.id) ?? Infinity;
      const bIndex = orderIndex.get(b.id) ?? Infinity;
      if (aIndex !== bIndex) return aIndex - bIndex;
      return sortComparator(a, b);
    });
}

function onStorage(event: StorageEvent): void {
  if (event.key === null || event.key === PIN_STORAGE_KEY) notify();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

function getServerSnapshot(): PinState {
  return EMPTY_PIN_STATE;
}

export interface PinsSnapshot extends PinState {
  isPinned: (id: string) => boolean;
}

/** Live pins for this browser, kept in sync across tabs via the `storage` event. */
export function usePins(): PinsSnapshot {
  const state = useSyncExternalStore(subscribe, readPinState, getServerSnapshot);
  return { ...state, isPinned: (id) => state.pinnedIds.includes(id) };
}
