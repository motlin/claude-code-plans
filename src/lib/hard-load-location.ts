import type {RouterHistory} from "@tanstack/react-router";

/**
 * Whether the page is still on the location the document was hard-loaded at, standing in for upstream's
 * `t7` WeakSet of router states that showed the route frame: a skeleton drawn there hands off from that
 * frame (shown at once), while one drawn after any SPA navigation away is held back for the delayed reveal.
 * The server render is the hard load, and hydration matches it.
 */
function locationKey(url: {pathname: string; search: string}): string
{
	return url.pathname + url.search;
}

/** `undefined` until tracking starts; `null` once the page has navigated away. */
let initial: string | null | undefined;

/**
 * Records the router history's current location as the hard-loaded one and forgets it on the first navigation
 * elsewhere. The history sees every push, replace and back/forward, so this needs no Navigation API (Safari has none).
 */
export function trackHardLoadLocation(history: Pick<RouterHistory, "location" | "subscribe">): void
{
	if (initial !== undefined) return;
	initial = locationKey(history.location);
	history.subscribe(({location}) =>
	{
		if (locationKey(location) !== initial) initial = null;
	});
}

/** True until tracking has seen a navigation away, including before tracking starts (the server render). */
export function onHardLoadLocation(): boolean
{
	return initial !== null;
}
