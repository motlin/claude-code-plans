/**
 * Where a session's approval card draws (upstream `Z_`). Upstream's function-valued placement (a live inline card
 * registering its slot) folds into `"card-and-queue-at-tail"`: locally the cluster's one live state draws both.
 */
export type ApprovalPlacement = "no-card" | "card-at-tail" | "card-and-queue-at-tail" | "card-above-turn-box";

export function approvalPlacement({
	inlineApprovals,
	isReadOnly,
	aboveTurnBox,
	clusterLive,
}: {
	/** Upstream's classic layout (no inline cluster) when false. */
	inlineApprovals: boolean;
	/** An archived session, which can answer nothing. */
	isReadOnly: boolean;
	/** The cluster is docked above the composer. */
	aboveTurnBox: boolean;
	/** A head card (with its "Also waiting" list) is drawn at the transcript's tail. */
	clusterLive: boolean;
}): ApprovalPlacement | undefined
{
	if (!inlineApprovals) return undefined;
	if (isReadOnly) return "no-card";
	if (aboveTurnBox) return "card-above-turn-box";
	if (clusterLive) return "card-and-queue-at-tail";
	return "card-at-tail";
}

/** Upstream's `$_`: the placement draws the queued requests, so their lone transcript rows give way. */
export function placementDrawsQueue(placement: ApprovalPlacement | undefined): boolean
{
	return placement === "card-and-queue-at-tail" || placement === "card-above-turn-box";
}
