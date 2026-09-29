import { z } from "zod";

import { orderedPins, type PinState } from "./pin-store";

export { slotFromPointer } from "./sidebar-drag";

/**
 * Pure logic behind the sidebar Pinned section and pin drag, mirroring claude.ai/code:
 * a pinned session moves out of its state/date/project group into Pinned (it is not
 * duplicated), and a drop resolves to one of the outcomes below.
 */
export const PIN_DROP_OUTCOMES = ["pin", "reorder", "unpin", "cancel"] as const;
export const PinDropOutcomeSchema = z.enum(PIN_DROP_OUTCOMES);
export type PinDropOutcome = z.infer<typeof PinDropOutcomeSchema>;

export interface SplitPinned<T> {
  readonly pinned: T[];
  readonly rest: T[];
}

/**
 * Split `sessions` into the Pinned section (user-ordered pins first, the rest by
 * `comparator`) and everything else, which keeps its input order.
 */
export function splitPinned<T extends { id: string }>(
  sessions: readonly T[],
  pins: PinState,
  comparator: (a: T, b: T) => number,
): SplitPinned<T> {
  const pinnedIds = new Set(pins.pinnedIds);
  return {
    pinned: orderedPins(sessions, comparator, pins),
    rest: sessions.filter((session) => !pinnedIds.has(session.id)),
  };
}

export interface DropInput {
  /** The dragged row is already pinned. */
  readonly srcPinned: boolean;
  /** Insertion slot among pinned rows, or null when off the list or a no-op move. */
  readonly slot: number | null;
  /** The pointer is below the pinned list's bottom edge. */
  readonly belowPinnedBottom: boolean;
}

/** What releasing a sidebar row drag does to the pins. */
export function dropOutcome({ srcPinned, slot, belowPinnedBottom }: DropInput): PinDropOutcome {
  if (belowPinnedBottom) {
    return srcPinned ? "unpin" : "cancel";
  }
  if (slot === null) {
    return "cancel";
  }
  return srcPinned ? "reorder" : "pin";
}

/**
 * Pins after placing `id` at `index` of the displayed Pinned rows (a drag pin or
 * reorder). The displayed order becomes the user order, like upstream's `pinnedOrder`
 * merge; ordered pins that are not displayed keep their relative order after them.
 */
export function placePin(
  state: PinState,
  displayedIds: readonly string[],
  id: string,
  index: number,
): PinState {
  const displayed = displayedIds.filter((key) => key !== id);
  const at = Math.max(0, Math.min(index, displayed.length));
  const placed = [...displayed.slice(0, at), id, ...displayed.slice(at)];
  const seen = new Set(placed);
  return {
    pinnedIds: state.pinnedIds.includes(id) ? state.pinnedIds : [...state.pinnedIds, id],
    pinnedOrder: [...placed, ...state.pinnedOrder.filter((key) => !seen.has(key))],
  };
}
