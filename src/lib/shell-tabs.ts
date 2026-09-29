import { useSyncExternalStore } from "react";

export interface ShellTab {
  id: string;
  ptyKey: string;
  title: string;
  /** A close frame has been requested; the tab goes once the socket confirms. */
  closing: boolean;
}

export const CLAUDE_TAB_ID = "claude";

export interface SessionShellTabs {
  tabs: readonly ShellTab[];
  /** The selected tab id, `CLAUDE_TAB_ID`, or null for the pane's default. */
  active: string | null;
  opened: number;
}

const EMPTY: SessionShellTabs = { tabs: [], active: null, opened: 0 };

/**
 * Shell tabs outlive the Terminal pane's mount: hiding the pane detaches the
 * sockets, and reopening it reattaches to the same PTYs (the server replays
 * their buffered output). Closing a tab is what ends a shell.
 */
const sessions = new Map<string, SessionShellTabs>();
const listeners = new Set<() => void>();

function update(sessionId: string, next: (state: SessionShellTabs) => SessionShellTabs): void {
  sessions.set(sessionId, next(sessions.get(sessionId) ?? EMPTY));
  for (const listener of listeners) listener();
}

export function addShellTab(sessionId: string, ptyKey: string): void {
  update(sessionId, (state) => {
    const opened = state.opened + 1;
    const id = `shell-${ptyKey}`;
    return {
      tabs: [
        ...state.tabs,
        { id, ptyKey, title: opened === 1 ? "Shell" : `Shell ${opened}`, closing: false },
      ],
      active: id,
      opened,
    };
  });
}

export function selectTerminalTab(sessionId: string, id: string): void {
  update(sessionId, (state) => ({ ...state, active: id }));
}

export function requestShellTabClose(sessionId: string, id: string): void {
  update(sessionId, (state) => ({
    ...state,
    tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, closing: true } : tab)),
  }));
}

/** Drop a tab; if it was selected, select its left neighbour. */
export function removeShellTab(sessionId: string, id: string): void {
  update(sessionId, (state) => {
    const index = state.tabs.findIndex((tab) => tab.id === id);
    if (index === -1) return state;
    const tabs = state.tabs.filter((tab) => tab.id !== id);
    if (state.active !== id) return { ...state, tabs };
    const neighbour = tabs[Math.max(0, index - 1)];
    return { ...state, tabs, active: index > 0 && neighbour ? neighbour.id : null };
  });
}

export function clearShellTabs(): void {
  sessions.clear();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useShellTabs(sessionId: string): SessionShellTabs {
  return useSyncExternalStore(
    subscribe,
    () => sessions.get(sessionId) ?? EMPTY,
    () => EMPTY,
  );
}
