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
