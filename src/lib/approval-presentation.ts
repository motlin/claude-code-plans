/** Where a pending approval draws: inline after the transcript ("card") or above the composer ("dock"). */
export type ApprovalPresentation = "card" | "dock";

/** Upstream's short-viewport dock trigger (cc970fefe `jR`). */
export const SHORT_VIEWPORT_QUERY = "(max-height: 420px)";

/**
 * Upstream's dock decision (cc970fefe `FR`, local triggers only): a short viewport docks the approval cluster,
 * and the head card that docked stays docked (`NR` latch) until a different head card arrives, even after the
 * viewport grows again. A new head docks only while the viewport is still short.
 */
export function nextApprovalPresentation({
	shortViewport,
	headId,
	latchedId,
}: {
	shortViewport: boolean;
	headId: string | null;
	latchedId: string | null;
}):
{
	presentation: ApprovalPresentation;
	latchedId: string | null;
}
{
	const latched = shortViewport && headId !== null ? headId : latchedId;
	return {
		presentation: shortViewport || (headId !== null && latched === headId) ? "dock" : "card",
		latchedId: latched,
	};
}
