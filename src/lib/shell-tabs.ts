import { useSyncExternalStore } from "react";

import {
  EMPTY_TERMINAL_TABS,
  reduceTerminalTabs,
  restoreTerminalTabs,
  serializeTerminalTabs,
  type TerminalTabsAction,
  type TerminalTabsState,
  terminalTabsStorageKey,
} from "./terminal-tabs";

/**
 * Shell tabs outlive the Terminal pane's mount: hiding the pane detaches the
 * sockets, and reopening it reattaches to the same PTYs (the server replays
 * their buffered output). The tab list is also kept per session in
 * localStorage, so a reload reattaches to shells the server still holds.
 * Closing a tab is what ends a shell.
 */
const sessions = new Map<string, TerminalTabsState>();
const listeners = new Set<() => void>();

function readStored(sessionId: string): string | null {
  try {
    return localStorage.getItem(terminalTabsStorageKey(sessionId));
  } catch {
    return null;
  }
}

function writeStored(sessionId: string, state: TerminalTabsState): void {
  try {
    localStorage.setItem(terminalTabsStorageKey(sessionId), serializeTerminalTabs(state));
  } catch {
    // Storage is a convenience; the in-memory list still works without it.
  }
}

function current(sessionId: string): TerminalTabsState {
  const known = sessions.get(sessionId);
  if (known) return known;
  const restored = restoreTerminalTabs(readStored(sessionId));
  sessions.set(sessionId, restored);
  return restored;
}

export function dispatchTerminalTabs(sessionId: string, action: TerminalTabsAction): void {
  const before = current(sessionId);
  const next = reduceTerminalTabs(before, action);
  if (next === before) return;
  sessions.set(sessionId, next);
  writeStored(sessionId, next);
  for (const listener of listeners) listener();
}

/** Forget the in-memory lists (tests); stored lists are reread on next use. */
export function clearShellTabs(): void {
  sessions.clear();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useShellTabs(sessionId: string): TerminalTabsState {
  return useSyncExternalStore(
    subscribe,
    () => current(sessionId),
    () => EMPTY_TERMINAL_TABS,
  );
}
