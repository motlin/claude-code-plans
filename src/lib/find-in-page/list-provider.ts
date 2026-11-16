/**
 * Upstream's list find provider (shared-100 `iz`) for a virtualized list. Matches are counted over every
 * item's text, mounted or not; showing one mounts its row through `scrollToIndex`, then paints the DOM
 * matches inside the mounted rows once the row lands. The active match is anchored by item key, so it
 * survives items streaming in or earlier ones being prepended.
 */

import {createContext, useContext, useEffect, useRef} from "react";

import {addFindRanges, removeFindRanges} from "./highlights";
import {collectFindRanges, countOccurrences} from "./match";
import {type FindProvider, registerFindProvider, requestFindRecount} from "./store";

/** Upstream `xE`: repaint attempts (two frames each) while the target row mounts. */
const MOUNT_RETRIES = 6;

/** Pages in the rest of a transcript's history, which a search counts once it lands (upstream `loadRest`). */
export const FindLoadRestContext = createContext<(() => Promise<void>) | null>(null);

export interface FindListOptions<T>
{
	readonly items: readonly T[];
	readonly surface: string;
	readonly getItemKey: (item: T) => string;
	/** The item's searchable text: what its row shows as prose. */
	readonly getSearchText: (item: T, index: number) => string;
	/** The element that orders this list's matches among the page's (usually the list itself). */
	readonly getScopeEl: () => Element | null;
	/** Mount the row at `index` and bring it toward the viewport. */
	readonly scrollToIndex: (index: number) => void;
	/** Every mounted row with its item index. */
	readonly getMountedRows: () => Iterable<readonly [number, Element]>;
	readonly enabled?: boolean;
}

interface Matches
{
	/** Rows with at least one match, ascending. */
	readonly rows: number[];
	readonly occurrences: number[];
	readonly total: number;
}

interface Active
{
	readonly key: string;
	readonly occurrence: number;
}

/** Upstream `g2`: the row and per-row occurrence of the list's `index`th match. */
function locate(
	matches: Matches,
	index: number,
):
{
	row: number;
	occurrence: number;
} | null
{
	let remaining = index;
	for (const [at, row] of matches.rows.entries())
	{
		const count = matches.occurrences[at] ?? 0;
		if (remaining < count)
		{
			return {
				row,
				occurrence: remaining,
			};
		}
		remaining -= count;
	}
	return null;
}

async function nextFrames(): Promise<void>
{
	await new Promise<void>((resolve) =>
	{
		requestAnimationFrame(() =>
		{
			requestAnimationFrame(() =>
			{
				resolve();
			});
		});
	});
}

function revealCentered(range: Range): void
{
	const node = range.startContainer;
	const element = node instanceof Element ? node : node.parentElement;
	element?.scrollIntoView(
		{
			block: "center",
		},
	);
}

export function useFindListProvider<T>(options: FindListOptions<T>): void
{
	const loadRest = useContext(FindLoadRestContext);
	const loadRestRef = useRef(loadRest);
	loadRestRef.current = loadRest;
	const optionsRef = useRef(options);
	optionsRef.current = options;
	const enabled = options.enabled ?? true;

	useEffect(() =>
	{
		if (!enabled) return undefined;
		/** Each item's search text and its folded count for the cached query, by item key. */
		let cache:
		{
			query: string;
			items: readonly T[];
			matches: Matches;
		} | null = null;
		const counted = new Map<
			string,
			{
				text: string;
				query: string;
				count: number;
			}
		>();
		let query = "";
		let active: Active | null = null;
		let painted: Range[] = [];
		let epoch = 0;

		const matchesFor = (value: string): Matches =>
		{
			const {items, getItemKey, getSearchText} = optionsRef.current;
			if (cache?.query === value && cache.items === items) return cache.matches;
			const matches: Matches =
			{
				rows: [],
				occurrences: [],
				total: 0,
			};
			let total = 0;
			for (const [index, item] of items.entries())
			{
				const key = getItemKey(item);
				const text = getSearchText(item, index);
				let entry = counted.get(key);
				if (entry?.text !== text || entry.query !== value)
				{
					entry =
					{
						text,
						query: value,
						count: countOccurrences(text, value),
					};
					counted.set(key, entry);
				}
				if (entry.count === 0) continue;
				matches.rows.push(index);
				matches.occurrences.push(entry.count);
				total += entry.count;
			}
			const result =
			{
				...matches,
				total,
			};
			cache =
			{
				query: value,
				items,
				matches: result,
			};
			return result;
		};

		const rowOf = (key: string): number =>
			optionsRef.current.items.findIndex((item) => optionsRef.current.getItemKey(item) === key);

		/** Upstream `KR`: paint the matches inside every mounted row; returns whether the active one was painted. */
		const paint = (reveal: boolean): boolean =>
		{
			removeFindRanges(painted);
			painted = [];
			if (query === "") return false;
			const activeRow = active === null ? -1 : rowOf(active.key);
			let activeRange: Range | null = null;
			for (const [index, row] of optionsRef.current.getMountedRows())
			{
				const ranges = collectFindRanges(row, query);
				painted.push(...ranges);
				if (index === activeRow && active !== null && ranges.length > 0)
					activeRange = ranges[Math.min(active.occurrence, ranges.length - 1)] ?? null;
			}
			addFindRanges(painted, activeRange);
			if (reveal && activeRange !== null) revealCentered(activeRange);
			return activeRange !== null;
		};

		const isMounted = (row: number): boolean =>
		{
			for (const [index] of optionsRef.current.getMountedRows()) if (index === row) return true;
			return false;
		};

		/** Upstream `xE`: repaint after the row mounts, retrying a few frame pairs while it doesn't. */
		const paintWhenMounted = async (row: number, token: number) =>
		{
			for (let attempt = 0; attempt < MOUNT_RETRIES; attempt++)
			{
				await nextFrames();
				if (token !== epoch) return;
				if (isMounted(row))
				{
					paint(true);
					return;
				}
			}
		};

		const provider: FindProvider =
		{
			surface: optionsRef.current.surface,
			count: (value) => matchesFor(value).total,
			getScopeEl: () => optionsRef.current.getScopeEl(),
			loadRest: (): Promise<void> | undefined => loadRestRef.current?.(),
			show: (value, index, reveal) =>
			{
				query = value;
				const token = ++epoch;
				if (index < 0)
				{
					active = null;
					paint(false);
					return;
				}
				const target = locate(matchesFor(value), index);
				const item = target === null ? undefined : optionsRef.current.items[target.row];
				if (target === null || item === undefined) return;
				active =
				{
					key: optionsRef.current.getItemKey(item),
					occurrence: target.occurrence,
				};
				if (!reveal)
				{
					paint(false);
					return;
				}
				if (isMounted(target.row))
				{
					paint(true);
					return;
				}
				paint(false);
				optionsRef.current.scrollToIndex(target.row);
				void paintWhenMounted(target.row, token);
			},
			activeMatchNow: (value) =>
			{
				if (active === null || value !== query) return undefined;
				const row = rowOf(active.key);
				const matches = matchesFor(value);
				const at = matches.rows.indexOf(row);
				if (row < 0 || at < 0) return -1;
				const before = matches.occurrences.slice(0, at).reduce((sum, count) => sum + count, 0);
				return before + Math.min(active.occurrence, (matches.occurrences[at] ?? 1) - 1);
			},
			clear: () =>
			{
				epoch++;
				query = "";
				active = null;
				removeFindRanges(painted);
				painted = [];
			},
		};
		const unregister = registerFindProvider(provider);
		return () =>
		{
			provider.clear();
			unregister();
		};
	}, [enabled]);

	// New or changed items move the count while a query is active (upstream `recountOnItemsChange`).
	const {items} = options;
	const firstRender = useRef(true);
	useEffect(() =>
	{
		if (firstRender.current)
		{
			firstRender.current = false;
			return;
		}
		requestFindRecount();
	}, [items]);
}
