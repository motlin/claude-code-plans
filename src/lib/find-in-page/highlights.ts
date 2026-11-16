/**
 * Upstream's find-in-page highlight layer (shared-100 `V4`/`Ht`/`SQ`/`$i`): every match is painted with
 * the CSS Custom Highlight API under `find-in-page`, and the active one again under
 * `find-in-page-active` at priority 1. The colours live in globals.css (`::highlight(find-in-page…)`).
 */

const FIND_HIGHLIGHT = "find-in-page";
const FIND_ACTIVE_HIGHLIGHT = "find-in-page-active";

function highlightApi():
	|
	  {
			registry: HighlightRegistry;
			Highlight: typeof Highlight;
	  }
	| undefined
{
	if (typeof CSS === "undefined" || !("highlights" in CSS) || typeof Highlight === "undefined") return undefined;
	return {
		registry: CSS.highlights,
		Highlight,
	};
}

/** Upstream `V4`: the named highlight, created on first use with its priority. */
function namedHighlight(name: string): Highlight | undefined
{
	const api = highlightApi();
	if (!api) return undefined;
	let highlight = api.registry.get(name);
	if (!highlight)
	{
		highlight = new api.Highlight();
		highlight.priority = name === FIND_ACTIVE_HIGHLIGHT ? 1 : 0;
		api.registry.set(name, highlight);
	}
	return highlight;
}

/** Add matches to the painted set, plus the active match when one is given (upstream `Ht` + `SQ`). */
export function addFindRanges(ranges: readonly Range[], active: Range | null): void
{
	const all = namedHighlight(FIND_HIGHLIGHT);
	for (const range of ranges) all?.add(range);
	if (active !== null)
	{
		const current = namedHighlight(FIND_ACTIVE_HIGHLIGHT);
		current?.clear();
		current?.add(active);
	}
}

/** Replace every painted match and the active one. */
export function paintFindHighlights(ranges: readonly Range[], active: Range | null): void
{
	namedHighlight(FIND_HIGHLIGHT)?.clear();
	namedHighlight(FIND_ACTIVE_HIGHLIGHT)?.clear();
	addFindRanges(ranges, active);
}

/** Upstream `$i`: drop both highlights. */
export function clearFindHighlights(): void
{
	const api = highlightApi();
	api?.registry.delete(FIND_HIGHLIGHT);
	api?.registry.delete(FIND_ACTIVE_HIGHLIGHT);
}

/** Take ranges a provider painted earlier back out, before it repaints its rows. */
export function removeFindRanges(ranges: readonly Range[]): void
{
	const api = highlightApi();
	if (!api) return;
	for (const name of [FIND_HIGHLIGHT, FIND_ACTIVE_HIGHLIGHT])
	{
		const highlight = api.registry.get(name);
		for (const range of ranges) highlight?.delete(range);
	}
}
