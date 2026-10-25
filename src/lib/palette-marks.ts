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

/** A session's palette mark and whether it leads; archived rows are never marked. */
export function paletteMark(session: PaletteMarkInput, now: number): {mark: PaletteMark; leads: boolean} | undefined {
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
