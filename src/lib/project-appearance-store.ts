import { useSyncExternalStore } from "react";
import { z } from "zod";

import {
  applyAppearancePatch,
  GroupAppearanceSchema,
  type GroupAppearance,
  type GroupAppearancePatch,
} from "./group-appearance";

/**
 * Per-browser project section appearance, like claude.ai/code's
 * `folderAppearanceByKey`: section key (`project-<name>`) → icon and color.
 */
export const PROJECT_APPEARANCE_STORAGE_KEY = "ccp-project-appearance";

const ProjectAppearanceMapSchema = z.record(z.string(), GroupAppearanceSchema);

export type ProjectAppearanceMap = Readonly<Record<string, GroupAppearance>>;

const EMPTY: ProjectAppearanceMap = {};

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedState: ProjectAppearanceMap = EMPTY;

function readRaw(): string | null {
  try {
    return localStorage.getItem(PROJECT_APPEARANCE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function parse(raw: string | null): ProjectAppearanceMap {
  if (raw === null) return EMPTY;
  try {
    const result = ProjectAppearanceMapSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : EMPTY;
  } catch {
    return EMPTY;
  }
}

/** Current map; absent, corrupt or unreadable storage yields no appearances. */
export function readProjectAppearance(): ProjectAppearanceMap {
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

/** Set or clear a project section's icon and color; an emptied entry is removed. */
export function setProjectAppearance(sectionKey: string, patch: GroupAppearancePatch): void {
  const { [sectionKey]: current = {}, ...rest } = readProjectAppearance();
  const next = applyAppearancePatch(current, patch);
  const map = Object.keys(next).length === 0 ? rest : { ...rest, [sectionKey]: next };
  try {
    localStorage.setItem(PROJECT_APPEARANCE_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Storage can be denied or full; appearance is best-effort per browser.
  }
  notify();
}

function onStorage(event: StorageEvent): void {
  if (event.key === null || event.key === PROJECT_APPEARANCE_STORAGE_KEY) notify();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

function getServerSnapshot(): ProjectAppearanceMap {
  return EMPTY;
}

/** Live project appearances for this browser, kept in sync across tabs. */
export function useProjectAppearance(): ProjectAppearanceMap {
  return useSyncExternalStore(subscribe, readProjectAppearance, getServerSnapshot);
}
