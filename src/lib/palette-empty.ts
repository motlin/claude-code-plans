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

export type PaletteEmptyKind = "nothing" | "filtered" | "failed" | "stalled" | "silent";

/**
 * Which empty state the palette shows, a port of upstream's `Sm`; null while searching or with rows.
 * "silent": a 1-character query never reaches the server, so only the live region speaks.
 * "filtered": a type tab or a date/project/archived token narrowed the search.
 * "stalled": a filtered search still unsettled after 8s, which upstream reports as a failure with Search all.
 */
export function paletteEmptyKind({
	query,
	searching,
	rowCount,
	filtered,
	failed,
	stalled,
}: {
	query: string;
	searching: boolean;
	rowCount: number;
	filtered: boolean;
	failed: boolean;
	stalled: boolean;
}): PaletteEmptyKind | null {
	if (searching || rowCount > 0) return null;
	if (query.trim().length === 1) return "silent";
	if (stalled) return "stalled";
	if (failed) return "failed";
	if (filtered) return "filtered";
	return "nothing";
}
