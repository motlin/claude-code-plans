/** Upstream's `ut`: one band sweep, matching the `cds-shimmer-text-band` animation in globals.css. */
export const SHIMMER_PERIOD_MS = 3000;

/** Upstream's `eE`: a negative delay that puts a freshly mounted shimmer in phase with the rest. */
export function shimmerPhaseDelay(): number {
	return -(performance.now() % SHIMMER_PERIOD_MS);
}
