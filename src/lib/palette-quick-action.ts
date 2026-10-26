/** Upstream's ⌘K search cap: a longer raw query is treated as a prompt, not a search. */
export const PALETTE_SEARCH_MAX_CHARS = 50;

/** Port of upstream `nn`: the RAW query length counts, spaces and newlines included. */
export function paletteSearchable(rawQuery: string): boolean {
	return rawQuery.length <= PALETTE_SEARCH_MAX_CHARS;
}

/** The Quick actions "New session" row shows only for a non-blank query too long to search. */
export function offersQuickNewSession(rawQuery: string): boolean {
	return !paletteSearchable(rawQuery) && rawQuery.trim() !== "";
}
