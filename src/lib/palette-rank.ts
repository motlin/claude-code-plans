// Upstream's typed-palette ordering (c74dd5c13 `B`/`we`, cf6507c5a `xd`/`Cd`) and organic cap (c2771e1f6 `fg`).

/** Upstream's `maxOrganicItems` for the default entrypoint: `Zn = K==="search" ? 25 : 7`. */
export const PALETTE_MAX_ORGANIC_ITEMS = 7;
/** Upstream's `$d`: the cap for each of local and fetched rows under a filter predicate. */
export const PALETTE_FILTERED_MAX_ITEMS = 25;

export type PaletteRank = 0 | 1 | 2;

/** Upstream's `xd`: split on non letters/digits, else the whole query as one token. */
export function paletteTokens(query: string): string[]
{
	const normalized = query.trim().toLowerCase();
	if (normalized === "") return [];
	const tokens = normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
	return tokens.length > 0 ? tokens : [normalized];
}

/** Upstream's `we`: 0 for a label prefix, 1 when every token is in the label (or names the PR), else 2. */
export function paletteRank(label: string, query: string, tokens: readonly string[], prNumber?: number): PaletteRank
{
	const normalized = label.trim().toLowerCase();
	if (normalized.startsWith(query.trim().toLowerCase())) return 0;
	const pr = prNumber === undefined ? undefined : String(prNumber);
	const allTokens = tokens.every(
		(token) =>
			normalized.includes(token) || token === pr || (pr !== undefined && token === "pr" && tokens.includes(pr)),
	);
	return tokens.length > 0 && allTokens ? 1 : 2;
}

/** Upstream's `B` order: rank-0 actions, rank-0 rows, rank-1 actions, rank-1 rows, rank-2 actions, rank-2 rows. */
export function interleaveByRank<
	A extends
	{
		rank: PaletteRank;
	},
	R extends
	{
		rank: PaletteRank;
	},
>(actions: readonly A[], rows: readonly R[]): (A | R)[]
{
	const ranks: PaletteRank[] = [0, 1, 2];
	return ranks.flatMap((rank) => [
		...actions.filter((action) => action.rank === rank),
		...rows.filter((row) => row.rank === rank),
	]);
}

/**
 * Upstream's `B` walk + `Ne = xe.slice(0, max(0, m − Ae − Te))`: keep `cap` counted items, then let fetched rows
 * fill the remainder. Uncounted (queryOnly) items are always kept.
 */
export function capOrganic<T, F>(
	ordered: readonly T[],
	fetched: readonly F[],
	cap: number,
	uncounted: (item: T) => boolean,
):
{
	kept: T[];
	fetched: F[];
}
{
	const kept: T[] = [];
	let counted = 0;
	for (const item of ordered)
	{
		if (uncounted(item))
		{
			kept.push(item);
		}
		else if (counted < cap)
		{
			kept.push(item);
			counted++;
		}
	}
	return {
		kept,
		fetched: fetched.slice(0, Math.max(0, cap - counted)),
	};
}
