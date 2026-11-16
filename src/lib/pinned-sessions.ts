import {z} from "zod";

import {orderedPins, type PinState} from "./pin-store";
import {type FamilyRow, resolveFamilies} from "./session-families";

export {slotFromPointer} from "./sidebar-drag";

/**
 * Pure logic behind the sidebar Pinned section and pin drag, mirroring claude.ai/code:
 * a pinned session moves out of its state/date/project group into Pinned (it is not
 * duplicated), and a drop resolves to one of the outcomes below.
 */
/** The pinned sessions page heading and tab name; kept here so its routes' `head` doesn't pull the page into the route tree. */
export const PINNED_SESSIONS_TITLE = "Pinned sessions";

export const PIN_DROP_OUTCOMES = ["pin", "reorder", "unpin", "cancel"] as const;
export const PinDropOutcomeSchema = z.enum(PIN_DROP_OUTCOMES);
export type PinDropOutcome = z.infer<typeof PinDropOutcomeSchema>;

export interface SplitPinned<T>
{
	/** Pinned slots: pinned family heads and flat pins, in display order (upstream `slotPinned`). */
	readonly pinned: T[];
	/** A pinned family head → its whole family in spawn-tree pre-order (upstream `qT` + `$Y "parent"`). */
	readonly nested: ReadonlyMap<string, T[]>;
	readonly rest: T[];
}

/**
 * Split `sessions` into the Pinned section (user-ordered pins first, the rest by
 * `comparator`) and everything else, which keeps its input order. A pinned family head
 * takes its whole fork family into Pinned, nested under it: a pinned member gives up its
 * own slot, and no member is left in `rest`. A pinned fork whose head is not pinned stays
 * a flat slot.
 */
export function splitPinned<
	T extends
	{
		id: string;
	} & FamilyRow,
>(sessions: readonly T[], pins: PinState, comparator: (a: T, b: T) => number): SplitPinned<T>
{
	const pinnedIds = new Set(pins.pinnedIds);
	const nested = new Map<string, T[]>();
	for (const {head, children} of resolveFamilies(sessions))
	{
		if (!pinnedIds.has(head.id) || children.length === 0) continue;
		nested.set(head.sessionId, resolveFamilies([head, ...children.toSorted(comparator)])[0]?.children ?? []);
	}
	const members = new Set([...nested.values()].flat().map((row) => row.id));
	return {
		pinned: orderedPins(sessions, comparator, pins).filter((row) => !members.has(row.id)),
		nested,
		rest: sessions.filter((session) => !pinnedIds.has(session.id) && !members.has(session.id)),
	};
}

export interface DropInput
{
	/** The dragged row is already pinned. */
	readonly srcPinned: boolean;
	/** Insertion slot among pinned rows, or null when off the list or a no-op move. */
	readonly slot: number | null;
	/** The pointer is below the pinned list's bottom edge. */
	readonly belowPinnedBottom: boolean;
}

/** What releasing a sidebar row drag does to the pins. */
export function dropOutcome({srcPinned, slot, belowPinnedBottom}: DropInput): PinDropOutcome
{
	if (belowPinnedBottom)
	{
		return srcPinned ? "unpin" : "cancel";
	}
	if (slot === null)
	{
		return "cancel";
	}
	return srcPinned ? "reorder" : "pin";
}

/**
 * Pins after placing `id` at `index` of the displayed Pinned rows (a drag pin or
 * reorder). The displayed order becomes the user order, like upstream's `pinnedOrder`
 * merge; ordered pins that are not displayed keep their relative order after them.
 */
export function placePin(state: PinState, displayedIds: readonly string[], id: string, index: number): PinState
{
	const displayed = displayedIds.filter((key) => key !== id);
	const at = Math.max(0, Math.min(index, displayed.length));
	const placed = [...displayed.slice(0, at), id, ...displayed.slice(at)];
	const seen = new Set(placed);
	return {
		pinnedIds: state.pinnedIds.includes(id) ? state.pinnedIds : [...state.pinnedIds, id],
		pinnedOrder: [...placed, ...state.pinnedOrder.filter((key) => !seen.has(key))],
	};
}
