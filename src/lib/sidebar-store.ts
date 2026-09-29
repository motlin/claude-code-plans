import { useSyncExternalStore } from "react";
import { z } from "zod";

import { useShortcut } from "../hooks/use-shortcut";

export const SIDEBAR_STORAGE_KEY = "ccb-sidebar";

export const SIDEBAR_MIN_WIDTH = 232;
export const SIDEBAR_MAX_WIDTH = 420;
export const SIDEBAR_RESIZE_STEP = 8;

const SidebarStateSchema = z.strictObject({
  collapsed: z.boolean(),
  width: z.number().int().min(SIDEBAR_MIN_WIDTH).max(SIDEBAR_MAX_WIDTH),
  collapsedGroups: z.array(z.string()),
  /** Collapsed fork families, keyed like upstream's `collapsedFamilies`: `code:<headSessionId>`. */
  collapsedFamilies: z.array(z.string()).default([]),
});

export type SidebarState = z.infer<typeof SidebarStateSchema>;

export const DEFAULT_SIDEBAR_STATE: SidebarState = {
  collapsed: false,
  width: 288,
  collapsedGroups: [],
  collapsedFamilies: [],
};

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedState: SidebarState = DEFAULT_SIDEBAR_STATE;

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
  } catch {
    return null;
  }
}

function parse(raw: string | null): SidebarState {
  if (raw === null) return DEFAULT_SIDEBAR_STATE;
  try {
    const result = SidebarStateSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : DEFAULT_SIDEBAR_STATE;
  } catch {
    return DEFAULT_SIDEBAR_STATE;
  }
}

/** Current persisted sidebar state; corrupt or unreadable storage yields defaults. */
export function readSidebarState(): SidebarState {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedState = parse(raw);
  }
  return cachedState;
}

export function writeSidebarState(state: SidebarState): void {
  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage can be denied or full; the sidebar keeps working with its in-memory render.
  }
  for (const listener of listeners) listener();
}

export function toggleSidebarCollapsed(): void {
  const state = readSidebarState();
  writeSidebarState({ ...state, collapsed: !state.collapsed });
}

export function setSidebarWidth(width: number): void {
  writeSidebarState({ ...readSidebarState(), width });
}

/** Collapse or expand one session-list group, keyed like upstream's `collapsedGroups`. */
export function toggleSidebarGroup(key: string): void {
  const state = readSidebarState();
  const collapsedGroups = state.collapsedGroups.includes(key)
    ? state.collapsedGroups.filter((collapsed) => collapsed !== key)
    : [...state.collapsedGroups, key];
  writeSidebarState({ ...state, collapsedGroups });
}

export function familyKey(headSessionId: string): string {
  return `code:${headSessionId}`;
}

/** Collapse or expand one fork family's nested sessions. */
export function toggleFamilyCollapsed(headSessionId: string): void {
  const state = readSidebarState();
  const key = familyKey(headSessionId);
  const collapsedFamilies = state.collapsedFamilies.includes(key)
    ? state.collapsedFamilies.filter((collapsed) => collapsed !== key)
    : [...state.collapsedFamilies, key];
  writeSidebarState({ ...state, collapsedFamilies });
}

/** Collapse or expand several fork families at once (upstream's Alt-click on a family handle). */
export function setFamiliesCollapsed(headSessionIds: readonly string[], collapsed: boolean): void {
  const state = readSidebarState();
  const keys = new Set(headSessionIds.map(familyKey));
  const collapsedFamilies = collapsed
    ? [...new Set([...state.collapsedFamilies, ...keys])]
    : state.collapsedFamilies.filter((key) => !keys.has(key));
  writeSidebarState({ ...state, collapsedFamilies });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getServerSnapshot(): SidebarState {
  return DEFAULT_SIDEBAR_STATE;
}

export function useSidebarState(): SidebarState {
  return useSyncExternalStore(subscribe, readSidebarState, getServerSnapshot);
}

/** Bind ⌘B / Ctrl+B to the sidebar toggle, including while a text field has focus. */
export function useSidebarToggleShortcut(): void {
  useShortcut("toggle_sidebar", () => toggleSidebarCollapsed(), { allowInEditable: true });
}
