/**
 * Upstream's find-in-page engine (shared-100 `YM` registry, `Mh` DOM provider, `YS` search, `CH` live
 * recount). Providers own text the DOM can't show in full (the virtualized transcript); everything else
 * on the page is the built-in DOM surface. Matches are numbered top to bottom: DOM matches before a
 * provider's scope element, then the provider's, then the DOM matches after it.
 */

import {clearFindHighlights, addFindRanges} from "./highlights";
import {collectFindRanges, isRangeVisible, newVisibilityCache} from "./match";

/** Upstream `za`: an element the DOM surface never searches (the find bar itself carries it). */
export const FIND_PROVIDER_SCOPE_ATTR = "data-find-provider-scope";

export interface FindProvider
{
	readonly surface: string;
	/** Matches for `query` across everything the provider owns, mounted or not. */
	count(query: string): number;
	/**
	 * Paint the provider's matches. `index` is the active match within this provider, or -1 when the
	 * active match is elsewhere; `reveal` brings the active match into view (false on a live recount).
	 */
	show(query: string, index: number, reveal: boolean): void;
	clear(): void;
	/** The element whose DOM position orders this provider's matches among the page's. */
	getScopeEl(): Element | null;
	/** Upstream `activeMatchNow`: the active match's index after the provider's items changed, -1 when it is gone. */
	activeMatchNow?(query: string): number | undefined;
	/** Upstream `loadRest`: start paging in content the provider has not loaded yet; resolves when it lands. */
	loadRest?(): Promise<void> | undefined;
}

export interface FindResult
{
	/** 1-based; 0 when nothing is active. */
	readonly activeIndex: number;
	readonly total: number;
}

/** A search's first result, plus the recount once providers finish paging in the rest of their content. */
export interface FindRun extends FindResult
{
	/** Settles with the recount, or null when a later search or close superseded it. */
	readonly settled?: Promise<FindResult | null>;
}

const EMPTY_RESULT: FindResult =
{
	activeIndex: 0,
	total: 0,
};

/** Upstream `l6`: the longest a search waits on providers paging in the rest of their content. */
const LOAD_REST_TIMEOUT_MS = 4000;

/** Upstream `CH`'s coalescing delay for DOM text changes while a query is active. */
const RECOUNT_DELAY_MS = 60;

const providers: FindProvider[] = [];
const providerListeners = new Set<() => void>();
const resultListeners = new Set<(result: FindResult) => void>();

interface DomSegment
{
	readonly kind: "dom";
	readonly start: number;
	readonly end: number;
}

interface ProviderSegment
{
	readonly kind: "provider";
	readonly provider: FindProvider;
}

type Segment = DomSegment | ProviderSegment;

let activeQuery = "";
/** Upstream `YW`: the 0-based global active match, -1 for none. */
let activeIndex = -1;
let domRanges: Range[] = [];
/** The provider the active match belongs to, or null for a DOM match or none. */
let activeProvider: FindProvider | null = null;
let activeDomRange: Range | null = null;
let observer: MutationObserver | null = null;
let recountTimer: ReturnType<typeof setTimeout> | undefined;
/** Bumped by every search and close, so a load that lands late can tell it was superseded. */
let searchEpoch = 0;

function notifyProviders(): void
{
	for (const listener of providerListeners) listener();
}

export function registerFindProvider(provider: FindProvider): () => void
{
	providers.push(provider);
	notifyProviders();
	if (activeQuery !== "") scheduleRecount();
	return () =>
	{
		const index = providers.indexOf(provider);
		if (index >= 0) providers.splice(index, 1);
		if (activeProvider === provider) activeProvider = null;
		notifyProviders();
		if (activeQuery !== "") scheduleRecount();
	};
}

/** Upstream `Fw`: the in-app bar is on offer only while something registered a provider. */
export function hasFindProviders(): boolean
{
	return providers.length > 0;
}

export function subscribeFindProviders(listener: () => void): () => void
{
	providerListeners.add(listener);
	return () =>
	{
		providerListeners.delete(listener);
	};
}

/** Live recount results, for the bar's status while text changes under an active query. */
export function subscribeFindResults(listener: (result: FindResult) => void): () => void
{
	resultListeners.add(listener);
	return () =>
	{
		resultListeners.delete(listener);
	};
}

/** Upstream `lC`: -1 when `a` comes before `b`. */
function documentOrder(a: Node, b: Node): number
{
	if (a === b) return 0;
	const position = a.compareDocumentPosition(b);
	if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
	if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
	return 0;
}

/** Upstream `Vv`: the outermost shadow host, so shadow-DOM ranges order by their host. */
function lightDomNode(node: Node): Node
{
	let current = node;
	for (let root = current.getRootNode(); root instanceof ShadowRoot; root = current.getRootNode())
		current = root.host;
	return current;
}

/** Upstream `Mh.count` plus `YS`'s segmenting: the DOM matches split around each provider's scope. */
function buildSegments(query: string): Segment[]
{
	const scoped:
	{
		provider: FindProvider;
		scope: Element;
	}[] = [];
	const unscoped: FindProvider[] = [];
	for (const provider of providers)
	{
		const scope = provider.getScopeEl();
		if (scope?.isConnected)
			scoped.push(
				{
					provider,
					scope,
				},
			);
		else unscoped.push(provider);
	}
	scoped.sort((a, b) => documentOrder(a.scope, b.scope));
	const exclude = new Set<Element>([
		...document.querySelectorAll(`[${FIND_PROVIDER_SCOPE_ATTR}]`),
		...scoped.map(({scope}) => scope),
	]);
	const cache = newVisibilityCache();
	domRanges = collectFindRanges(
		document.body,
		query,
		{
			exclude,
		},
	).filter((range) => isRangeVisible(range, cache));

	const segments: Segment[] = [];
	let start = 0;
	for (const {provider, scope} of scoped)
	{
		let end = start;
		for (
			let range = domRanges[end];
			range && documentOrder(lightDomNode(range.startContainer), scope) < 0;
			range = domRanges[end]
		)
			end++;
		segments.push(
			{
				kind: "dom",
				start,
				end,
			},
			{
				kind: "provider",
				provider,
			},
		);
		start = end;
	}
	segments.push(
		{
			kind: "dom",
			start,
			end: domRanges.length,
		},
	);
	for (const provider of unscoped)
		segments.push(
			{
				kind: "provider",
				provider,
			},
		);
	return segments;
}

function segmentCount(segment: Segment, query: string): number
{
	if (segment.kind === "dom") return segment.end - segment.start;
	try
	{
		return segment.provider.count(query);
	}
	catch
	{
		return 0;
	}
}

function isTextNode(node: Node): node is Text
{
	return node.nodeType === Node.TEXT_NODE;
}

function contains(ancestor: Node, node: Node): boolean
{
	for (
		let current: Node | null = node;
		current;
		current = current.parentNode ?? (current instanceof ShadowRoot ? current.host : null)
	)
	{
		if (current === ancestor) return true;
	}
	return false;
}

/**
 * Upstream `rr`: find the active DOM match among fresh ranges, by the same text node and offsets, else
 * by its place among the matches under the same parent. -1 when it can't be found.
 */
function relocate(previous: Range, previousRanges: readonly Range[], next: readonly Range[]): number
{
	const start = previous.startContainer;
	if (!start.isConnected) return -1;
	if (!previous.collapsed && isTextNode(start) && isTextNode(previous.endContainer))
	{
		const exact = next.findIndex(
			(range) =>
				range.startContainer === start &&
				range.startOffset === previous.startOffset &&
				range.endContainer === previous.endContainer &&
				range.endOffset === previous.endOffset,
		);
		if (exact >= 0) return exact;
	}
	const parent = isTextNode(start) ? start.parentNode : start;
	if (!parent) return -1;
	const under = (ranges: readonly Range[]) =>
		ranges.flatMap((range, index) => (contains(parent, range.startContainer) ? [index] : []));
	const nextUnder = under(next);
	if (nextUnder.length === 0) return -1;
	const previousUnder = under(previousRanges);
	const at = Math.max(0, previousUnder.indexOf(previousRanges.indexOf(previous)));
	return nextUnder[Math.min(at, nextUnder.length - 1)] ?? -1;
}

type FindMode = "query" | "step" | "recount";

function search(query: string, forward: boolean, mode: FindMode): FindResult
{
	const previousRanges = domRanges;
	const previousActiveDom = activeDomRange;
	const previousProvider = activeProvider;
	const segments = buildSegments(query);
	const counts = segments.map((segment) => segmentCount(segment, query));
	const total = counts.reduce((sum, count) => sum + count, 0);
	const offsetOf = (index: number) => counts.slice(0, index).reduce((sum, count) => sum + count, 0);

	if (mode === "query") activeIndex = total > 0 ? 0 : -1;
	else if (mode === "step")
	{
		activeIndex =
			total === 0
				? -1
				: activeIndex < 0
					? forward
						? 0
						: total - 1
					: (Math.min(activeIndex, total - 1) + (forward ? 1 : -1) + total) % total;
	}
	else
	{
		let kept: number | undefined;
		if (previousProvider !== null)
		{
			const at = segments.findIndex(
				(segment) => segment.kind === "provider" && segment.provider === previousProvider,
			);
			const local = at >= 0 ? previousProvider.activeMatchNow?.(query) : undefined;
			if (local !== undefined && local >= 0) kept = offsetOf(at) + local;
		}
		else if (previousActiveDom !== null)
		{
			const domIndex = relocate(previousActiveDom, previousRanges, domRanges);
			const at = segments.findIndex(
				(segment) => segment.kind === "dom" && domIndex >= segment.start && domIndex < segment.end,
			);
			const segment = segments[at];
			if (segment?.kind === "dom") kept = offsetOf(at) + domIndex - segment.start;
		}
		activeIndex = total === 0 ? -1 : (kept ?? Math.min(Math.max(activeIndex, 0), total - 1));
	}

	let activeSegment = -1;
	let localIndex = -1;
	for (let index = 0, offset = 0; activeIndex >= 0 && index < counts.length; index++)
	{
		const count = counts[index] ?? 0;
		if (activeIndex < offset + count)
		{
			activeSegment = index;
			localIndex = activeIndex - offset;
			break;
		}
		offset += count;
	}

	const active = segments[activeSegment];
	activeProvider = active?.kind === "provider" ? active.provider : null;
	activeDomRange = active?.kind === "dom" ? (domRanges[active.start + localIndex] ?? null) : null;

	const reveal = mode !== "recount";
	clearFindHighlights();
	addFindRanges(domRanges, activeDomRange);
	if (reveal && activeDomRange !== null) revealRange(activeDomRange);
	for (const [index, segment] of segments.entries())
	{
		if (segment.kind !== "provider") continue;
		try
		{
			segment.provider.show(query, index === activeSegment ? localIndex : -1, reveal);
		}
		catch
		{
			// A provider's failure leaves the rest of the page's matches standing, as upstream's `hg` does.
		}
	}
	return {
		activeIndex: activeIndex >= 0 ? activeIndex + 1 : 0,
		total,
	};
}

/** Upstream `F0`: bring the active DOM match's element into view, as little as possible. */
function revealRange(range: Range): void
{
	const node = range.startContainer;
	const element = node instanceof Element ? node : node.parentElement;
	element?.scrollIntoView(
		{
			block: "nearest",
		},
	);
}

function startObserving(): void
{
	if (observer !== null || typeof MutationObserver === "undefined") return;
	observer = new MutationObserver((records) =>
	{
		// The bar's own status and input never change what the page matches.
		if (records.every((record) => isInsideFindScope(record.target))) return;
		scheduleRecount();
	});
	observer.observe(
		document.body,
		{
			childList: true,
			subtree: true,
			characterData: true,
		},
	);
}

function isInsideFindScope(node: Node): boolean
{
	const element = node instanceof Element ? node : node.parentElement;
	return element?.closest(`[${FIND_PROVIDER_SCOPE_ATTR}]`) != null;
}

function scheduleRecount(): void
{
	if (activeQuery === "" || recountTimer !== undefined) return;
	recountTimer = setTimeout(() =>
	{
		recountTimer = undefined;
		if (activeQuery === "") return;
		const result = recountFind();
		for (const listener of resultListeners) listener(result);
	}, RECOUNT_DELAY_MS);
}

/**
 * Upstream `Hg`/`Ph`: search for `query`. A new query makes match 1 active; otherwise the active match
 * steps forward or back with wrap. An empty query clears every highlight.
 */
export function runFind(query: string, forward: boolean, isNewQuery: boolean): FindRun
{
	if (query === "")
	{
		endFind();
		return EMPTY_RESULT;
	}
	const mode: FindMode = isNewQuery || query !== activeQuery ? "query" : "step";
	activeQuery = query;
	const epoch = ++searchEpoch;
	startObserving();
	const result = search(query, forward, mode);
	if (mode !== "query") return result;
	const loads = providers.flatMap((provider) =>
	{
		try
		{
			const load = provider.loadRest?.();
			return load === undefined ? [] : [load];
		}
		catch
		{
			return [];
		}
	});
	if (loads.length === 0) return result;
	const landed = Promise.all(loads).then(
		() => undefined,
		() => undefined,
	);
	const timeout = new Promise<void>((resolve) =>
	{
		setTimeout(resolve, LOAD_REST_TIMEOUT_MS);
	});
	return {
		...result,
		settled: Promise.race([landed, timeout]).then(() =>
			epoch === searchEpoch && activeQuery === query ? recountFind() : null,
		),
	};
}

/** Recount the active query after the page's text changed, keeping the active match where it can be found. */
export function recountFind(): FindResult
{
	if (activeQuery === "") return EMPTY_RESULT;
	return search(activeQuery, true, "recount");
}

/** Ask for a coalesced recount, for a provider whose items changed without a DOM change. */
export function requestFindRecount(): void
{
	scheduleRecount();
}

/** Upstream `Uz`/`XJ`: drop the query, every highlight and the providers' painted state. */
export function endFind(): void
{
	searchEpoch++;
	activeQuery = "";
	activeIndex = -1;
	activeProvider = null;
	activeDomRange = null;
	domRanges = [];
	clearTimeout(recountTimer);
	recountTimer = undefined;
	observer?.disconnect();
	observer = null;
	clearFindHighlights();
	for (const provider of providers)
	{
		try
		{
			provider.clear();
		}
		catch
		{
			// Keep clearing the rest.
		}
	}
}
