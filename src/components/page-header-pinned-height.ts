/**
 * Upstream c193cfc9b `me`: the last measured pinned height per `band|width|contentGap|!!subtitle|!!tabs` header shape, so a
 * remounted sticky page header publishes it before its first measurement.
 */
export const pinnedHeightCache = new Map<string, number>();

/** Test hook: forget every cached pinned height. */
export function resetPinnedHeightCache(): void
{
	pinnedHeightCache.clear();
}
