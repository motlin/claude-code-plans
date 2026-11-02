import {useEffect, useRef, useState} from "react";

import {STALE_COMPACT} from "../lib/stale-compact";

export interface StaleCompactIdle
{
	readonly anchor: number;
	readonly ageMs: number;
}

const MIN_AGE_MS = STALE_COMPACT.minAgeMinutes * 60_000;

/**
 * Upstream `nke`'s idle clock check `n()` (cc43287c9, crawl 2026-11-06): it runs at mount, on window focus,
 * on visibilitychange to visible, on focusin/keydown inside the session footer (the treatment arm, which
 * local always takes) and when the scope shows again. Unlike the cold-resume clock it has no interval and
 * no `document.hasFocus()` check. It never clears a stored stretch; a newer anchor just fails to match it.
 */
export function useStaleCompactIdle({
	anchorMs,
	responding,
	hidden,
}: {
	anchorMs: number | null;
	responding: boolean;
	hidden: boolean;
}): StaleCompactIdle | null
{
	const [idle, setIdle] = useState<StaleCompactIdle | null>(null);
	const respondingRef = useRef(responding);
	respondingRef.current = responding;
	useEffect(() =>
	{
		if (anchorMs === null) return undefined;
		const check = () =>
		{
			if (respondingRef.current || hidden) return;
			const ageMs = Date.now() - anchorMs;
			if (ageMs < MIN_AGE_MS) return;
			setIdle((previous) =>
				previous?.anchor === anchorMs && Math.floor(previous.ageMs / 60_000) === Math.floor(ageMs / 60_000)
					? previous
					:
						{
							anchor: anchorMs,
							ageMs,
						},
			);
		};
		const onVisibility = () =>
		{
			if (document.visibilityState === "visible") check();
		};
		const inFooter = (event: Event) =>
		{
			if (event.target instanceof Element && event.target.closest("[data-session-footer]") !== null) check();
		};
		check();
		window.addEventListener("focus", check);
		document.addEventListener("visibilitychange", onVisibility);
		document.addEventListener("focusin", inFooter);
		document.addEventListener("keydown", inFooter);
		return () =>
		{
			window.removeEventListener("focus", check);
			document.removeEventListener("visibilitychange", onVisibility);
			document.removeEventListener("focusin", inFooter);
			document.removeEventListener("keydown", inFooter);
		};
	}, [anchorMs, hidden]);
	return idle;
}
