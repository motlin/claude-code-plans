import { useSyncExternalStore, type ReactNode } from "react";

import type { PaneKind } from "../../lib/pane-layout";

/** Host-owned header pieces handed to panes that draw their own header. */
export interface PaneChrome {
  /** The centered Move drag handle. */
  moveHandle: ReactNode;
  /** Expand/Collapse and Close, for the right end of the pane header. */
  controls: ReactNode;
}

export interface PaneDefinition {
  /** Header title, also used in divider labels ("Resize Chat and <title>"). */
  title: string;
  /**
   * `"custom"` panes render their whole surface, header included, placing the
   * host's `chrome` themselves (upstream's Changes header puts its own
   * controls around Move, Expand and Close).
   */
  header?: "custom";
  render: (chrome: PaneChrome) => ReactNode;
}

const definitions = new Map<PaneKind, PaneDefinition>();
const listeners = new Set<() => void>();
let snapshot: ReadonlyMap<PaneKind, PaneDefinition> = new Map();

function publish(): void {
  snapshot = new Map(definitions);
  for (const listener of listeners) listener();
}

/** Registers the renderer for a pane kind; returns a function that unregisters it. */
export function registerPane(kind: PaneKind, definition: PaneDefinition): () => void {
  definitions.set(kind, definition);
  publish();
  return () => {
    if (definitions.get(kind) !== definition) return;
    definitions.delete(kind);
    publish();
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ReadonlyMap<PaneKind, PaneDefinition> {
  return snapshot;
}

export function usePaneDefinitions(): ReadonlyMap<PaneKind, PaneDefinition> {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
