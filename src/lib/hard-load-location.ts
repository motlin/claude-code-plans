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

/** `undefined` until captured; `null` once the page has navigated away. */
let initial: string | null | undefined;

/** Records the current location as the hard-loaded one. The root route calls this at boot. */
export function captureHardLoadLocation(): void
{
	if (typeof window === "undefined" || initial !== undefined) return;
	initial = locationKey(window.location);
	const forget = () =>
	{
		if (initial !== locationKey(window.location)) initial = null;
	};
	window.addEventListener("popstate", forget);
	// Navigation API (where present) also sees the router's pushState navigations.
	const navigation = (
		window as
		{
			navigation?: EventTarget;
		}
	).navigation;
	navigation?.addEventListener("navigate", (event) =>
	{
		const destination = (
			event as Event &
			{
				destination?:
				{
					url: string;
				};
			}
		).destination;
		if (destination !== undefined && locationKey(new URL(destination.url)) !== initial) initial = null;
	});
}

export function onHardLoadLocation(): boolean
{
	if (typeof window === "undefined") return true;
	captureHardLoadLocation();
	if (initial !== locationKey(window.location)) initial = null;
	return initial !== null;
}
