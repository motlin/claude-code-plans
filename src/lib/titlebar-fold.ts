/**
 * Upstream's measured titlebar fold (claude.ai/code chunks cd54a5401 and
 * c73f45bc3), ported as pure maths. The pills compact first, then trail
 * buttons fold into View options one step at a time: the rail toggle, then
 * inactive panes in list order, then the open one.
 */

/** The title keeps up to this much of its natural width before buttons fold (`kt`). */
const TITLE_KEEP_PX = 100;
/** Slack beyond one step before a button reveals again (`At`). */
const REVEAL_SLACK_PX = 24;
/** Step used before any toggle has been measured (`jt`). */
export const DEFAULT_STEP_PX = 32;
/** Free space the pills need before they re-expand (`Mt`). */
const PILL_REEXPAND_FREE_PX = 96;
/** Hysteresis tolerance (`Nt`). */
const TOLERANCE_PX = 1;
/** Free space at or under which the pills compact (`Pt`). */
const PILL_COMPACT_FREE_PX = 0.5;
/** Extra budget a refused re-expand demands next time (`It`). */
const REEXPAND_REFUSED_PX = 4;
/** Measure passes allowed per burst before giving up (`Ft`). */
export const MAX_PASSES = 8;

/** `zt`: the rail toggle (with its separator) folds first, then the main panes. */
export function foldBudget({railToggleFoldable, hiddenCount}: {railToggleFoldable: boolean; hiddenCount: number}) {
	const railToggleFolded = railToggleFoldable && hiddenCount > 0;
	return {
		maxHidden: railToggleFoldable ? 7 : 6,
		railToggleFolded,
		hiddenMainPanes: railToggleFolded ? hiddenCount - 1 : hiddenCount,
	};
}

/** `G_`: the first n of `[...inactive, ...active]` fold; both lists keep the original order. */
export function splitPanes<T extends {active: boolean}>(
	panes: readonly T[],
	count: number,
): {folded: T[]; inline: T[]} {
	const n = Math.min(Math.max(0, Math.trunc(count) || 0), panes.length);
	if (n === 0) return {folded: [], inline: [...panes]};
	const order = [...panes.filter((pane) => !pane.active), ...panes.filter((pane) => pane.active)];
	const folding = new Set(order.slice(0, n));
	return {
		folded: panes.filter((pane) => folding.has(pane)),
		inline: panes.filter((pane) => !folding.has(pane)),
	};
}

/** `Wt`: free space once the title keeps up to 100px of its natural width. */
export function freeAfterTitle({
	freePx,
	titleClientPx,
	titleNaturalPx,
	shortfallPx = 0,
}: {
	freePx: number;
	titleClientPx: number;
	titleNaturalPx: number;
	shortfallPx?: number;
}): number {
	return freePx + titleClientPx - Math.min(titleNaturalPx, TITLE_KEEP_PX) - shortfallPx;
}

/** `Gt`: how far the title spills past its cluster plus how far the last child spills past the row. */
export function overflowShortfall({
	titleEnd,
	leadEnd,
	lastEnd,
	rowEnd,
}: {
	titleEnd: number;
	leadEnd: number | undefined;
	lastEnd: number | undefined;
	rowEnd: number;
}): number {
	return (
		(leadEnd === undefined ? 0 : Math.max(0, titleEnd - leadEnd)) +
		(lastEnd === undefined ? 0 : Math.max(0, lastEnd - rowEnd))
	);
}

/** `Kt`: how many more buttons to hide (positive) or reveal (negative). */
export function nextHidden(free: number, step: number, hidden: number, max = 6): number {
	if (free < -1 && hidden < max) return Math.min(Math.ceil(-free / step), max - hidden);
	if (free >= step + REVEAL_SLACK_PX && hidden > 0)
		return -Math.min(Math.floor((free - REVEAL_SLACK_PX) / step), hidden);
	return 0;
}

/** `qt`: compact with no free space and a truncated title; re-expand only with room to spare. */
export function pillsCompact(
	previous: boolean,
	{
		freePx,
		titleClientPx,
		titleNaturalPx,
		hidden,
		pillBudget,
		pillBudgetAtCollapse,
	}: {
		freePx: number;
		titleClientPx: number;
		titleNaturalPx: number;
		hidden: number;
		pillBudget: number;
		pillBudgetAtCollapse: number;
	},
): boolean {
	if (previous)
		return !(hidden === 0 && pillBudget > pillBudgetAtCollapse + TOLERANCE_PX && freePx >= PILL_REEXPAND_FREE_PX);
	return freePx <= PILL_COMPACT_FREE_PX && titleClientPx < titleNaturalPx;
}

/** One measurement of the titlebar row. */
export interface FoldGeometry {
	/** The gaps between the row's children. */
	freePx: number;
	/** The widths of the row's children other than the title's cluster. */
	otherPx: number;
	/** `overflowShortfall` of the row. */
	shortfallPx: number;
	titleClientPx: number;
	/** The title's `scrollWidth`. */
	titleNaturalPx: number;
	/** The row's `clientWidth`. */
	rootPx: number;
	/** The first inline toggle's width plus the gap, the size of one fold step. */
	stepPx: number;
}

export interface FoldState {
	hidden: number;
	compact: boolean;
	pillBudgetAtCollapse: number;
	/** The pills compacted during this measure burst, so they may not re-expand in it. */
	compactedThisBurst: boolean;
}

/** One pass of upstream's measure (`Jt`'s `G`): pill compaction with hysteresis, then the hide/reveal step. */
export function foldPass(geometry: FoldGeometry, state: FoldState, maxHidden: number): FoldState {
	const pillBudget = geometry.rootPx - geometry.otherPx - geometry.titleNaturalPx;
	let compact = pillsCompact(state.compact, {
		freePx: geometry.freePx,
		titleClientPx: geometry.titleClientPx,
		titleNaturalPx: geometry.titleNaturalPx,
		hidden: state.hidden,
		pillBudget,
		pillBudgetAtCollapse: state.pillBudgetAtCollapse,
	});
	let {pillBudgetAtCollapse, compactedThisBurst} = state;
	if (state.compact && !compact && compactedThisBurst) {
		compact = true;
		pillBudgetAtCollapse = pillBudget + REEXPAND_REFUSED_PX;
	} else if (compact && !state.compact) {
		pillBudgetAtCollapse = pillBudget;
		compactedThisBurst = true;
	} else if (!compact && state.compact) {
		pillBudgetAtCollapse = -Infinity;
	}
	const free = freeAfterTitle({
		freePx: geometry.freePx,
		titleClientPx: geometry.titleClientPx,
		titleNaturalPx: geometry.titleNaturalPx,
		shortfallPx: geometry.shortfallPx,
	});
	const hidden = state.hidden + nextHidden(free, geometry.stepPx, state.hidden, maxHidden);
	return {hidden, compact, pillBudgetAtCollapse, compactedThisBurst};
}
