import {useSyncExternalStore} from "react";

/** Upstream `UF`'s second query: a forced-colors (high contrast) display. */
const FORCED_COLORS_QUERY = "(forced-colors: active)";

function subscribeForcedColors(onChange: () => void): () => void
{
	if (typeof window.matchMedia !== "function")
		return () =>
		{
		};
	const media = window.matchMedia(FORCED_COLORS_QUERY);
	media.addEventListener("change", onChange);
	return () =>
	{
		media.removeEventListener("change", onChange);
	};
}

function snapshot(): boolean
{
	return typeof window.matchMedia === "function" && window.matchMedia(FORCED_COLORS_QUERY).matches;
}

function serverSnapshot(): boolean
{
	return false;
}

/** True while the display forces its own colours, re-rendering when that changes; false on the server. */
export function useForcedColors(): boolean
{
	return useSyncExternalStore(subscribeForcedColors, snapshot, serverSnapshot);
}
