import {useEffect} from "react";
import {prefetchWhenIdle} from "../lib/idle-prefetch";

/**
 * Warms deferred chunks once the hydrated page is visible and idle; pass a module-level array so it runs once per
 * mount. Test renders skip it so suites stay deterministic, and tests drive `prefetchWhenIdle` directly instead.
 */
export function useIdlePrefetch(loaders: ReadonlyArray<() => Promise<unknown>>): void {
	useEffect(() => {
		if (import.meta.env.MODE === "test") return undefined;
		return prefetchWhenIdle(loaders);
	}, [loaders]);
}
