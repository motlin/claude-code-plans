/** Upstream drops the query from the empty copy once it passes this length. */
const PALETTE_EMPTY_QUERY_MAX = 50;

/**
 * The palette's no-results copy, a port of upstream's `zg`.
 * `scope` is the type tab's label, or null on the All tab.
 */
export function paletteEmptyMessage(query: string, scope: string | null): string {
	const shown = query.length <= PALETTE_EMPTY_QUERY_MAX ? query.trim() : "";
	if (shown === "") return scope === null ? "No results found" : `No results in ${scope}`;
	return scope === null ? `No results for “${shown}”` : `No results for “${shown}” in ${scope}`;
}

export type PaletteEmptyKind = "nothing" | "filtered" | "failed" | "silent";

/**
 * Which empty state the palette shows, a port of upstream's `Sm`; null while searching or with rows.
 * "silent": a 1-character query never reaches the server, so only the live region speaks.
 * "filtered": a type tab or a date/project/archived token narrowed the search.
 */
export function paletteEmptyKind({
	query,
	searching,
	rowCount,
	filtered,
	failed,
}: {
	query: string;
	searching: boolean;
	rowCount: number;
	filtered: boolean;
	failed: boolean;
}): PaletteEmptyKind | null {
	if (searching || rowCount > 0) return null;
	if (query.trim().length === 1) return "silent";
	if (failed) return "failed";
	if (filtered) return "filtered";
	return "nothing";
}
