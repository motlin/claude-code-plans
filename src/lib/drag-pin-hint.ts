import { useSyncExternalStore } from "react";

import { readSidebarState } from "./sidebar-store";

/**
 * Whether the "drag to pin" coach mark is requested, like claude.ai/code's
 * `maybeShowDragPinHint`. A menu pin requests it while the sidebar is expanded;
 * the Pinned section shows it unless the persisted `seenDragPinHint` is set.
 */
let requested = false;
const listeners = new Set<() => void>();

function set(next: boolean): void {
  if (requested === next) return;
  requested = next;
  for (const listener of listeners) listener();
}

/** After a menu pin: request the hint, unless the sidebar is collapsed. */
export function maybeShowDragPinHint(): void {
  if (readSidebarState().collapsed) return;
  set(true);
}

export function closeDragPinHint(): void {
  set(false);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDragPinHintRequested(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => requested,
    () => false,
  );
}
