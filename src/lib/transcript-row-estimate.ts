/** An unmeasured transcript row's estimated height, before the virtualizer measures it. */
export const ESTIMATED_TURN_HEIGHT_PIXELS = 320;
/** Upstream's virtualizer estimate for a chapter row (`case"chapter":return 48`). */
const ESTIMATED_CHAPTER_HEIGHT_PIXELS = 48;

/** A row's estimate by its `data-perf-row` kind; chapter headings are the only `assistant_other` rows. */
export function estimatedRowHeight(kind: string): number {
	return kind === "assistant_other" ? ESTIMATED_CHAPTER_HEIGHT_PIXELS : ESTIMATED_TURN_HEIGHT_PIXELS;
}
