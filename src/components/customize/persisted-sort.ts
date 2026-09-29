import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function readStoredSort(key: string): string | undefined {
  try {
    return window.localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

export function writeStoredSort(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode, blocked site data); the URL still carries the sort.
  }
  for (const listener of listeners) listener();
}

/**
 * The sort a section should use: the `?sort=` param when present, otherwise
 * the last choice saved under `storageKey`. The server snapshot is always
 * undefined, so SSR renders the default and the client adopts the stored
 * value after hydration.
 */
export function useSectionSort(
  storageKey: string | undefined,
  urlSort: string | undefined,
): string | undefined {
  const stored = useSyncExternalStore(
    subscribe,
    () => (storageKey === undefined ? undefined : readStoredSort(storageKey)),
    () => undefined,
  );
  return urlSort ?? stored;
}
