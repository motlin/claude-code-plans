import type {SessionListItem} from "./api/sessions";

/**
 * Upstream's palette row marks (`gf`/`mf`) for code sessions. Upstream's `draft` mark only applies
 * to claude.ai chat conversations, so it has no local counterpart.
 */
export type PaletteMark = "awaiting" | "error" | "unread" | "running";

/** Upstream's `uf` lead ranking: awaiting, then error, unread, running. */
export const PALETTE_MARK_RANK = {awaiting: 0, error: 1, unread: 2, running: 3} as const satisfies Record<
	PaletteMark,
	number
>;

/** Upstream's sr-only row labels, appended after the title. */
export const PALETTE_MARK_LABELS = {
	awaiting: "Awaiting input",
	error: "Error",
	unread: "Unread",
	running: "Running",
} as const satisfies Record<PaletteMark, string>;

/** A marked row leads (is promoted to the top group) when updated within 7 days; awaiting always leads. */
export const LEAD_WINDOW_MS = 6048e5;

export type PaletteMarkInput = Pick<SessionListItem, "bucket" | "unseen" | "archived" | "mtime" | "unseenError">;

function markFor({bucket, unseen, unseenError}: PaletteMarkInput): PaletteMark | undefined {
	if (bucket === "blocked") return unseenError === true ? "error" : "awaiting";
	if (bucket === "working") return "running";
	// An open PR (`review`) with nothing unseen gets no mark: upstream has no PR mark.
	if (unseen) return "unread";
	return undefined;
}

/** A row's mark and whether it leads (is promoted above Recents). */
export interface PaletteMarkEntry {
	mark: PaletteMark;
	leads: boolean;
}

/** A session's palette mark and whether it leads; archived rows are never marked. */
export function paletteMark(session: PaletteMarkInput, now: number): PaletteMarkEntry | undefined {
	if (session.archived) return undefined;
	const mark = markFor(session);
	if (mark === undefined) return undefined;
	const leads = mark === "awaiting" || Date.parse(session.mtime) >= now - LEAD_WINDOW_MS;
	return {mark, leads};
}

/** Leads sorted by mark rank; the sort is stable, so recency order holds within a rank. */
export function sortLeads<T extends {mark: PaletteMark}>(leads: readonly T[]): T[] {
	return leads.toSorted((a, b) => PALETTE_MARK_RANK[a.mark] - PALETTE_MARK_RANK[b.mark]);
}

/** A row the empty-view fitter places; leads carry their mark so running ones split into Active. */
export interface PaletteFitItem {
	id: string;
	mark?: PaletteMark;
}

export interface PaletteGroup<T> {
	id: "attention" | "active" | "recents" | "actions";
	title: string;
	items: readonly T[];
}

/** Upstream's `fm` estimate of the list's rendered geometry, independent of density. */
export const PALETTE_FIT_METRICS = {paddingY: 20, groupTitle: 37, row: 36, groupGap: 4} as const;
/** The list's height cap the empty view must fit. */
const PALETTE_FIT_HEIGHT = 440;
/** At most this many leads are promoted above Recents. */
const PALETTE_LEAD_LIMIT = 5;
/** Trimming keeps at least one row in Actions and Recents (upstream's `pm`). */
const MIN_TRIMMED_ROWS = 1;

/** Upstream's `mm`: the estimated height of a list of groups. */
export function paletteViewHeight(groups: readonly PaletteGroup<unknown>[]): number {
	const {paddingY, groupTitle, row, groupGap} = PALETTE_FIT_METRICS;
	return groups.reduce(
		(height, group) => height + (group.title === "" ? 0 : groupTitle) + group.items.length * row,
		paddingY + Math.max(0, groups.length - 1) * groupGap,
	);
}

/** Upstream's `hm`: drop just enough rows from one group to fit, keeping at least one. */
function trimGroup<T>(groups: readonly PaletteGroup<T>[], id: PaletteGroup<T>["id"]): PaletteGroup<T>[] {
	const target = groups.find((group) => group.id === id);
	const overflow = paletteViewHeight(groups) - PALETTE_FIT_HEIGHT;
	if (target === undefined || overflow <= 0 || target.items.length <= MIN_TRIMMED_ROWS) return [...groups];
	const keep = Math.max(MIN_TRIMMED_ROWS, target.items.length - Math.ceil(overflow / PALETTE_FIT_METRICS.row));
	return groups.map((group) => (group === target ? {...group, items: group.items.slice(0, keep)} : group));
}

/**
 * Upstream's `ym`: promote the first `count` leads into Needs attention, moving running ones into
 * an Active group after it, and drop the promoted rows from Recents.
 */
function promoteLeads<T extends PaletteFitItem>(
	base: readonly PaletteGroup<T>[],
	leads: readonly T[],
	count: number,
): PaletteGroup<T>[] {
	const promoted = leads.slice(0, count);
	if (promoted.length === 0) return [...base];
	const promotedIds = new Set(promoted.map((item) => item.id));
	const leadGroups: PaletteGroup<T>[] = [
		{id: "attention", title: "Needs attention", items: promoted.filter((item) => item.mark !== "running")},
		{id: "active", title: "Active", items: promoted.filter((item) => item.mark === "running")},
	];
	const rest = base
		.map((group) =>
			group.id === "recents" ? {...group, items: group.items.filter((item) => !promotedIds.has(item.id))} : group,
		)
		.filter((group) => group.id !== "recents" || group.items.length > 0);
	return [...leadGroups.filter((group) => group.items.length > 0), ...rest];
}

/**
 * Upstream's `_m` over `vm`/`ym`: try 5 leads (or fewer when fewer lead) down to 0, trimming Actions
 * then Recents to a single row each, and keep the first candidate that fits the 440px list.
 * `leads` must already be rank-sorted (`sortLeads`).
 */
export function fitPaletteEmptyView<T extends PaletteFitItem>({
	leads,
	recents,
	actions,
}: {
	leads: readonly T[];
	recents: readonly T[];
	actions: readonly T[];
}): PaletteGroup<T>[] {
	const base: PaletteGroup<T>[] = [
		{id: "recents", title: "Recents", items: recents},
		{id: "actions", title: "Actions", items: actions},
	].filter((group): group is PaletteGroup<T> => group.items.length > 0);
	let fitted: PaletteGroup<T>[] = [];
	for (let count = Math.min(leads.length, PALETTE_LEAD_LIMIT); count >= 0; count--) {
		fitted = trimGroup(trimGroup(promoteLeads(base, leads, count), "actions"), "recents");
		if (paletteViewHeight(fitted) <= PALETTE_FIT_HEIGHT) break;
	}
	return fitted;
}

/**
 * Upstream's row secondary (`Zn`): "PR #N" and the relative time joined by " · ". The empty view
 * passes no time (upstream's `timesHidden`), so it shows the PR alone.
 */
export function paletteSecondary({
	prNumber,
	time,
}: {
	prNumber: number | undefined;
	time: string | null | undefined;
}): string | undefined {
	const parts = [prNumber === undefined ? undefined : `PR #${prNumber}`, time].filter(
		(part): part is string => part !== undefined && part !== null && part !== "",
	);
	return parts.length === 0 ? undefined : parts.join(" · ");
}
