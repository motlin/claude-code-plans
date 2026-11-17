/** Upstream's stack primitive constants (shared-40 `Oy`, `iS`, `g2`): at most two ghosts, 6px apart, 3% narrower each. */
const APPROVAL_STACK_MAX_GHOSTS = 2;
const APPROVAL_STACK_OFFSET_PX = 6;
const APPROVAL_STACK_SCALE_STEP = 0.03;

/** Upstream's approval host ghost class (c2d1aeb56 `x`). */
const APPROVAL_GHOST_CLASS =
	"rounded-card bg-surface-1 origin-top transition-[transform,opacity] duration-[220ms] ease-[cubic-bezier(0.215,0.61,0.355,1)] motion-reduce:transition-none";

/**
 * Upstream's queued-request ghosts (shared-40 `Re`): one card-shaped layer per queued request, up to two, peeking
 * above the card's top edge behind it. A ghost added or removed just mounts or unmounts; the rest glide.
 */
export function ApprovalStackGhosts({queueDepth}: {queueDepth: number})
{
	const count = Math.min(Math.max(queueDepth, 0), APPROVAL_STACK_MAX_GHOSTS);
	return Array.from(
		{
			length: count,
		},
		(_, index) =>
		{
			const depth = index + 1;
			return (
				<div
					key={depth}
					aria-hidden="true"
					className={`absolute inset-0 ${APPROVAL_GHOST_CLASS}`}
					style={
					{
						transform: `translateY(-${depth * APPROVAL_STACK_OFFSET_PX}px) scale(${1 - depth * APPROVAL_STACK_SCALE_STEP})`,
						zIndex: -depth,
						opacity: 1 - depth * 0.25,
					}}
				/>
			);
		},
	);
}
