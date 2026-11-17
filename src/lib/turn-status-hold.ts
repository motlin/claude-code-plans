import type {TurnStatusState} from "./working-marker";

/** Upstream `Gh`: a busy row with steps holds each busy label this long before another busy one. */
export const TURN_STATUS_BUSY_HOLD_MS = 2000;

/** Upstream gR's `settleMs`: a TurnStatus row's new label waits this long before it shows. */
export const TURN_STATUS_SETTLE_MS = 250;

interface ShownState
{
	state: TurnStatusState;
}

/**
 * Upstream gR's `minMs`: busy → busy holds 2s on a row with steps and the default (650ms) on a leaf row;
 * any other change swaps at once.
 */
export function turnStatusMinMs(incoming: TurnStatusState, leaf: boolean): (shown: ShownState) => number | undefined
{
	return (shown) =>
		shown.state === "busy" && incoming === "busy" ? (leaf ? undefined : TURN_STATUS_BUSY_HOLD_MS) : 0;
}

/** Upstream `xj`: the busy steps' keys, sorted and joined, or none for an empty set. */
export function busyLineKey(keys: readonly string[]): string | undefined
{
	return keys.length === 0 ? undefined : keys.toSorted().join("\0");
}

/** Upstream gR's `Ky` options: the row's minimum, its settle, the busy line on a row with steps, and restretch. */
export function turnStatusHoldOptions(
	incoming: TurnStatusState,
	leaf: boolean,
	line: string | undefined,
):
{
	minMs: (shown: ShownState) => number | undefined;
	settleMs: number;
	line: string | undefined;
	restretch: true;
}
{
	return {
		minMs: turnStatusMinMs(incoming, leaf),
		settleMs: TURN_STATUS_SETTLE_MS,
		line: incoming === "busy" && !leaf ? line : undefined,
		restretch: true,
	};
}

/** Upstream wr's `minMs`: a shown busy step holds the default (650ms) before busy or done; anything else swaps at once. */
export function stepHoldMinMs(incoming: TurnStatusState): (shown: ShownState) => number | undefined
{
	return (shown) => (shown.state === "busy" && (incoming === "busy" || incoming === "done") ? undefined : 0);
}
