import {useCallback, useLayoutEffect, useRef, type RefCallback} from "react";
import {useFizzyLake} from "./fizzy-lake";

/*
 * Upstream's row-cut observer (shared-frame `n_`, backed by `AD`): one ResizeObserver per
 * window toggles `data-cds-row-cut` on every watched element while its text overflows
 * (`scrollWidth > clientWidth`), and the globals.css rule turns that into a 24px end fade.
 * Gated by fizzy-lake `type` at the call sites (cds-type-experiment-gate).
 */

interface RowCutWatch
{
	ctor: typeof ResizeObserver;
	observer: ResizeObserver;
	watched: Set<Element>;
}

const watches = new WeakMap<object, RowCutWatch>();

function watchFor(view: typeof globalThis): RowCutWatch | undefined
{
	// SSR and a bare jsdom have no ResizeObserver.
	const ctor = (
		view as
		{
			ResizeObserver?: typeof ResizeObserver;
		}
	).ResizeObserver;
	if (ctor === undefined) return undefined;
	const existing = watches.get(view);
	if (existing?.ctor === ctor) return existing;
	const watched = new Set<Element>();
	const observer = new ctor((entries) =>
	{
		// Read every width before writing any attribute, as upstream does.
		const cuts = entries.map(
			(entry) => [entry.target, entry.target.scrollWidth > entry.target.clientWidth] as const,
		);
		for (const [target, cut] of cuts) target.toggleAttribute("data-cds-row-cut", cut);
		for (const node of watched)
		{
			if (!node.isConnected)
			{
				observer.unobserve(node);
				watched.delete(node);
			}
		}
	});
	const watch =
	{
		ctor,
		observer,
		watched,
	};
	watches.set(view, watch);
	return watch;
}

function observe(node: Element)
{
	const watch = watchFor(globalThis);
	if (watch === undefined) return;
	watch.watched.add(node);
	watch.observer.observe(node);
}

/**
 * A ref callback that marks the element `data-cds-row-cut` while it overflows, or
 * `undefined` when disabled. `dep` is the element's text: a change re-observes it, so the
 * attribute follows a text change even when the box keeps its size.
 */
export function useRowCut(enabled: boolean, dep: string): RefCallback<HTMLElement> | undefined
{
	const nodes = useRef<HTMLElement[]>([]);
	const ref = useCallback((node: HTMLElement | null) =>
	{
		nodes.current = nodes.current.filter((seen) => seen.isConnected);
		if (node === null) return;
		if (!nodes.current.includes(node)) nodes.current.push(node);
		observe(node);
	}, []);
	useLayoutEffect(() =>
	{
		if (!enabled) return;
		for (const node of nodes.current) if (node.isConnected) observe(node);
	}, [enabled, dep]);
	return enabled ? ref : undefined;
}

/** Upstream `Me(MM("type"), text)`: the transcript status rows fade their labels only under fizzy-lake `type`. */
export function useTypeRowCut(dep: string): RefCallback<HTMLElement> | undefined
{
	return useRowCut(useFizzyLake("type"), dep);
}
