import {useSyncExternalStore} from "react";

/** Upstream's MH: the OS reduced-motion query. */
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Upstream's $v: the root attribute holding the effective reduced-motion state. The settings
 * provider writes `html[data-reduce-motion="true"]` for Settings ▸ Motion ▸ Reduced or the OS query.
 */
export const REDUCE_MOTION_ATTRIBUTE = "data-reduce-motion";

function osReduced(view: Window | null): boolean
{
	return typeof view?.matchMedia === "function" && view.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** Upstream's am(): true under the OS query or `html[data-reduce-motion=true]`; false on the server. */
export function isMotionReduced(doc?: Document): boolean
{
	const target = doc ?? (typeof document === "undefined" ? undefined : document);
	if (target === undefined) return false;
	return osReduced(target.defaultView) || target.documentElement.getAttribute(REDUCE_MOTION_ATTRIBUTE) === "true";
}

const listeners = new Set<() => void>();
let detach: (() => void) | undefined;

function notify(): void
{
	for (const listener of listeners) listener();
}

function attach(): () => void
{
	const media = typeof window.matchMedia === "function" ? window.matchMedia(REDUCED_MOTION_QUERY) : undefined;
	media?.addEventListener("change", notify);
	const observer = new MutationObserver(notify);
	observer.observe(
		document.documentElement,
		{
			attributes: true,
			attributeFilter: [REDUCE_MOTION_ATTRIBUTE],
		},
	);
	return () =>
	{
		media?.removeEventListener("change", notify);
		observer.disconnect();
	};
}

/**
 * Upstream's Zt/Hn: one media `change` listener and one MutationObserver on <html> per window, shared
 * by every subscriber and detached when the last one leaves.
 */
export function subscribeReducedMotion(onChange: () => void): () => void
{
	listeners.add(onChange);
	detach ??= attach();
	return () =>
	{
		listeners.delete(onChange);
		if (listeners.size === 0 && detach !== undefined)
		{
			detach();
			detach = undefined;
		}
	};
}

function snapshot(): boolean
{
	return isMotionReduced();
}

function serverSnapshot(): boolean
{
	return false;
}

/** Upstream's ub(): the effective reduced-motion state, re-rendering when it changes. */
export function useReducedMotion(): boolean
{
	return useSyncExternalStore(subscribeReducedMotion, snapshot, serverSnapshot);
}

function subscribeOsQuery(onChange: () => void): () => void
{
	if (typeof window.matchMedia !== "function")
		return () =>
		{
		};
	const media = window.matchMedia(REDUCED_MOTION_QUERY);
	media.addEventListener("change", onChange);
	return () =>
	{
		media.removeEventListener("change", onChange);
	};
}

function osSnapshot(): boolean
{
	return osReduced(window);
}

/** Upstream's r$G($$): the OS reduced-motion query alone, which feeds the root attribute. */
export function usePrefersReducedMotion(): boolean
{
	return useSyncExternalStore(subscribeOsQuery, osSnapshot, serverSnapshot);
}
