/*
 * Upstream's usage-meter slide-in and severity crossfade (chunk c37952aed, export `t`), gated by
 * GrowthBook `__gb__1500379757` (shared-19 `Yg`, plus an org flags-loaded check and a `treatment`
 * experiment arm). The gate was off for the live account on 2026-11-06; locally it ships on
 * (upstream-sync M6, 11-04 Q2 answer c). Switching it off leaves the inert `data-usage-bars` wrapper.
 */
export const USAGE_BARS_CROSSFADE: boolean = true;

/** Upstream's `d` (cds dur.slow), `f`, cds ease.out, `m` and `p`. */
export const USAGE_BARS_GROW =
{
	durationMs: 450,
	staggerMs: 60,
	easing: "cubic-bezier(0.165, 0.84, 0.44, 1)",
	firstPlayWindowMs: 10_000,
	afterFirstPlayWindowMs: 3_000,
} as const;

/** One stagger index per distinct parent, in first-seen order: a fill and its share overlay move together. */
export function staggerIndexes(fills: readonly Element[]): number[]
{
	const byParent = new Map<Element | null, number>();
	return fills.map((fill) =>
	{
		const index = byParent.get(fill.parentElement) ?? byParent.size;
		byParent.set(fill.parentElement, index);
		return index;
	});
}

/** Upstream's window: 10s from the decision until the first slide plays, then 3s after it. */
export function withinGrowWindow({
	now,
	decidedAt,
	firstPlayedAt,
}: {
	now: number;
	decidedAt: number;
	firstPlayedAt: number | null;
}): boolean
{
	return firstPlayedAt === null
		? now - decidedAt <= USAGE_BARS_GROW.firstPlayWindowMs
		: now - firstPlayedAt <= USAGE_BARS_GROW.afterFirstPlayWindowMs;
}
