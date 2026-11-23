import {createContext, useContext, useState} from "react";

import type {SessionBucket} from "./session-state";
import {familyKey} from "./sidebar-store";

export interface FoldableRow
{
	sessionId: string;
	bucket: SessionBucket;
	session:
	{
		unseenError?: true | undefined;
	};
}

export interface FamilySplit<Row>
{
	kept: Row[];
	hidden: Row[];
}

/**
 * Upstream `Nk` with keep test `Jb` (starred or open): a folded family still lists its pinned and open
 * nested rows, in their original order; every other nested row, awaiting ones included, hides behind the stub.
 */
export function splitFoldedFamily<Row extends FoldableRow>(
	nested: readonly Row[],
	{
		collapsed,
		pinnedIds,
		openKeys,
	}:
	{
		collapsed: boolean;
		pinnedIds: readonly string[];
		openKeys: ReadonlySet<string>;
	},
): FamilySplit<Row>
{
	if (!collapsed)
		return {
			kept: [...nested],
			hidden: [],
		};
	const kept: Row[] = [];
	const hidden: Row[] = [];
	for (const row of nested)
	{
		const keep = pinnedIds.includes(row.sessionId) || openKeys.has(row.sessionId);
		(keep ? kept : hidden).push(row);
	}
	return {
		kept,
		hidden,
	};
}

/** What decides which nested rows a family lists: its fold, the pins and the latched open rows. */
export interface FamilyFoldState
{
	collapsedFamilies: readonly string[];
	pinnedIds: readonly string[];
	openKeys: ReadonlySet<string>;
}

/** The nested rows a family head shows: all of them, or a folded family's kept rows. */
export function displayedNested<Row extends FoldableRow>(
	headId: string,
	nested: readonly Row[],
	{collapsedFamilies, pinnedIds, openKeys}: FamilyFoldState,
): Row[]
{
	return splitFoldedFamily(
		nested,
		{
			collapsed: collapsedFamilies.includes(familyKey(headId)),
			pinnedIds,
			openKeys,
		},
	).kept;
}

export interface FoldOpenKeys
{
	keys: readonly string[];
	open: ReadonlySet<string>;
}

const NO_OPEN_KEYS: ReadonlySet<string> = new Set();

function sameKeys(a: readonly string[], b: readonly string[]): boolean
{
	return a.length === b.length && a.every((key, index) => key === b[index]);
}

/**
 * Upstream `XP`'s latch: while the fold state holds, newly open rows join the kept set and stay there
 * after the route moves on; any fold change resets it to the rows open now. Local storage re-parses the
 * whole sidebar state on unrelated writes, so the fold state is compared by content, not identity.
 */
export function nextFoldOpenKeys(
	prev: FoldOpenKeys | undefined,
	{
		collapsedFamilies,
		open,
	}:
	{
		collapsedFamilies: readonly string[];
		open: readonly string[];
	},
): FoldOpenKeys
{
	if (collapsedFamilies.length === 0)
		return prev?.keys.length === 0
			? prev
			:
				{
					keys: collapsedFamilies,
					open: NO_OPEN_KEYS,
				};
	if (prev === undefined || !sameKeys(prev.keys, collapsedFamilies))
		return {
			keys: collapsedFamilies,
			open: new Set(open),
		};
	if (open.every((key) => prev.open.has(key))) return prev;
	return {
		keys: prev.keys,
		open: new Set([...prev.open, ...open]),
	};
}

/** The latched open rows a folded family keeps listed. */
export function useFoldOpenKeys(collapsedFamilies: readonly string[], activeItemId: string | null): ReadonlySet<string>
{
	const open = activeItemId === null ? [] : [activeItemId];
	const [state, setState] = useState(() =>
		nextFoldOpenKeys(
			undefined,
			{
				collapsedFamilies,
				open,
			},
		),
	);
	const next = nextFoldOpenKeys(
		state,
		{
			collapsedFamilies,
			open,
		},
	);
	if (next !== state) setState(next);
	return next.open;
}

export const FoldOpenKeysContext = createContext<ReadonlySet<string>>(NO_OPEN_KEYS);

export function useFoldOpenKeysContext(): ReadonlySet<string>
{
	return useContext(FoldOpenKeysContext);
}
