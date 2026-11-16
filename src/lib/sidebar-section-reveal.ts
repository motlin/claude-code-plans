import {truncates} from "./session-groups";

export interface RevealThroughInput
{
	/** Every row key of the section, shown or hidden, in display order (upstream `sorted`). */
	keys: readonly string[];
	truncateAt: number;
	extraRevealed: number;
	hiddenCount: number;
	collapsed: boolean;
	/** Open (or kept-in-view) row keys, already aliased to their family heads. */
	openKeys: ReadonlySet<string>;
	/** A row just moved or pinned that must come into view (upstream `pF.rowKey`). */
	revealKey?: string | null;
	/** Rows a list-level Load more sessions just fetched (upstream `pF.landedKeys`). */
	landedKeys?: ReadonlySet<string> | null;
}

/**
 * Upstream `AE`: how many rows past the first page a section must reveal so its last open row, its
 * reveal row and its last landed row all show. Grow-only: the result is never below `extraRevealed`.
 */
export function revealThrough({
	keys,
	truncateAt,
	extraRevealed,
	hiddenCount,
	collapsed,
	openKeys,
	revealKey = null,
	landedKeys = null,
}: RevealThroughInput): number
{
	const shown = truncateAt + extraRevealed;
	let reveal = extraRevealed;
	if (!collapsed && hiddenCount > 0)
	{
		for (let index = keys.length - 1; index >= shown; index--)
		{
			if (openKeys.has(keys[index] ?? ""))
			{
				reveal = Math.max(reveal, index + 1 - truncateAt);
				break;
			}
		}
	}
	if (revealKey !== null && truncates(keys.length, truncateAt, extraRevealed))
	{
		const index = keys.indexOf(revealKey, shown);
		if (index !== -1) reveal = Math.max(reveal, index + 1 - truncateAt);
	}
	if (landedKeys !== null && truncates(keys.length, truncateAt, extraRevealed))
	{
		for (let index = keys.length - 1; index >= shown; index--)
		{
			if (landedKeys.has(keys[index] ?? ""))
			{
				reveal = Math.max(reveal, index + 1 - truncateAt);
				break;
			}
		}
	}
	return reveal;
}

/** Upstream `rz`: the open keys plus each nested key's family head (`heldBy`). */
export function withHeads(keys: Iterable<string>, headOf: ReadonlyMap<string, string>): Set<string>
{
	const result = new Set<string>();
	for (const key of keys)
	{
		result.add(key);
		const head = headOf.get(key);
		if (head !== undefined) result.add(head);
	}
	return result;
}
