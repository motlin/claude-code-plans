/**
 * Upstream's measured titlebar fold (claude.ai/code chunks cd54a5401 and
 * c73f45bc3), ported as pure maths. The pills compact first, then trail
 * buttons fold into View options one step at a time: the inactive panes in
 * list order, then the open one, then the rail toggle.
 */

/** The title keeps up to this much of its natural width before a pane folds (`Ht`). */
const PANE_TITLE_CLAIM_PX = 160;
/** The title keeps up to this much of its natural width before the rail toggle folds (`Ut`). */
const RAIL_TITLE_CLAIM_PX = 100;
/** Pane toggle slots the fold reserves ahead of the rail toggle. */
export const PANE_SLOTS = 6;
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

/** `en`: the pane slots fold first, then the rail toggle. */
export function foldBudget({
	railToggleFoldable,
	paneSlots = PANE_SLOTS,
	hiddenCount,
}: {
	railToggleFoldable: boolean;
	paneSlots?: number;
	hiddenCount: number;
})
{
	return {
		maxHidden: railToggleFoldable ? paneSlots + 1 : 6,
		railToggleFolded: railToggleFoldable && hiddenCount > paneSlots,
		hiddenMainPanes: Math.min(hiddenCount, paneSlots),
	};
}

/** The fold's limits: every foldable button, and how many of them are pane toggles. */
export interface FoldLimits
{
	maxHidden: number;
	paneSlots: number;
}

/** `G_`: the first n of `[...inactive, ...active]` fold; both lists keep the original order. */
export function splitPanes<
	T extends
	{
		active: boolean;
	},
>(
	panes: readonly T[],
	count: number,
):
{
	folded: T[];
	inline: T[];
}
{
	const n = Math.min(Math.max(0, Math.trunc(count) || 0), panes.length);
	if (n === 0)
		return {
			folded: [],
			inline: [...panes],
		};
	const order = [...panes.filter((pane) => !pane.active), ...panes.filter((pane) => pane.active)];
	const folding = new Set(order.slice(0, n));
	return {
		folded: panes.filter((pane) => folding.has(pane)),
		inline: panes.filter((pane) => !folding.has(pane)),
	};
}

/** `sn`: free space once the title keeps up to `claimPx` (160px by default) of its natural width. */
export function freeAfterTitle({
	freePx,
	titleClientPx,
	titleNaturalPx,
	shortfallPx = 0,
	claimPx = PANE_TITLE_CLAIM_PX,
}: {
	freePx: number;
	titleClientPx: number;
	titleNaturalPx: number;
	shortfallPx?: number;
	claimPx?: number;
}): number
{
	return freePx + titleClientPx - Math.min(titleNaturalPx, claimPx) - shortfallPx;
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
}): number
{
	return (
		(leadEnd === undefined ? 0 : Math.max(0, titleEnd - leadEnd)) +
		(lastEnd === undefined ? 0 : Math.max(0, lastEnd - rowEnd))
	);
}

/** `Kt`: how many more buttons to hide (positive) or reveal (negative). */
export function nextHidden(free: number, step: number, hidden: number, max = 6): number
{
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
	}:
	{
		freePx: number;
		titleClientPx: number;
		titleNaturalPx: number;
		hidden: number;
		pillBudget: number;
		pillBudgetAtCollapse: number;
	},
): boolean
{
	if (previous)
		return !(hidden === 0 && pillBudget > pillBudgetAtCollapse + TOLERANCE_PX && freePx >= PILL_REEXPAND_FREE_PX);
	return freePx <= PILL_COMPACT_FREE_PX && titleClientPx < titleNaturalPx;
}

/** One measurement of the titlebar row. */
export interface FoldGeometry
{
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

export interface FoldState
{
	hidden: number;
	compact: boolean;
	pillBudgetAtCollapse: number;
	/** The pills compacted during this measure burst, so they may not re-expand in it. */
	compactedThisBurst: boolean;
}

/**
 * One pass of upstream's measure (`dn`): pill compaction with hysteresis, then
 * the hide/reveal step in two tiers. Panes fold while the title would drop
 * under 160px; once every pane slot is folded, the rail toggle folds (and
 * reveals first) against a 100px claim.
 */
export function foldPass(geometry: FoldGeometry, state: FoldState, {maxHidden, paneSlots}: FoldLimits): FoldState
{
	const pillBudget = geometry.rootPx - geometry.otherPx - geometry.titleNaturalPx;
	let compact = pillsCompact(
		state.compact,
		{
			freePx: geometry.freePx,
			titleClientPx: geometry.titleClientPx,
			titleNaturalPx: geometry.titleNaturalPx,
			hidden: state.hidden,
			pillBudget,
			pillBudgetAtCollapse: state.pillBudgetAtCollapse,
		},
	);
	let {pillBudgetAtCollapse, compactedThisBurst} = state;
	if (state.compact && !compact && compactedThisBurst)
	{
		compact = true;
		pillBudgetAtCollapse = pillBudget + REEXPAND_REFUSED_PX;
	}
	else if (compact && !state.compact)
	{
		pillBudgetAtCollapse = pillBudget;
		compactedThisBurst = true;
	}
	else if (!compact && state.compact)
	{
		pillBudgetAtCollapse = -Infinity;
	}
	const title =
	{
		freePx: geometry.freePx,
		titleClientPx: geometry.titleClientPx,
		titleNaturalPx: geometry.titleNaturalPx,
		shortfallPx: geometry.shortfallPx,
	};
	const railStep = nextHidden(
		freeAfterTitle(
			{
				...title,
				claimPx: RAIL_TITLE_CLAIM_PX,
			},
		),
		geometry.stepPx,
		Math.max(0, state.hidden - paneSlots),
		maxHidden - paneSlots,
	);
	const step =
		state.hidden > paneSlots || (state.hidden === paneSlots && railStep > 0)
			? railStep
			: nextHidden(freeAfterTitle(title), geometry.stepPx, state.hidden, Math.min(paneSlots, maxHidden));
	const hidden = state.hidden + step;
	return {
		hidden,
		compact,
		pillBudgetAtCollapse,
		compactedThisBurst,
	};
}
