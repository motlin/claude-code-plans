/**
 * Upstream's `CommandMatcher` (`qn` in the Claude Code resident module, the CLI's own `/` matcher) ported field for
 * field onto the same Fuse.js 7.0.0. Find it in new builds by the literal `threshold:.3`.
 */
import Fuse from "fuse.js";

/** Upstream `LM`'s output: what the matcher ranks. */
export interface CommandCandidate
{
	name: string;
	displayName: string;
	description?: string | undefined;
	aliases: readonly string[];
	usageKey: string;
}

export interface CommandMatcherItem<C extends CommandCandidate>
{
	partKey: string[] | undefined;
	displayPartKey: string[] | undefined;
	commandName: string;
	displayName: string;
	candidate: C;
	aliasKey: readonly string[];
	descriptionWords: string[];
}

interface MatchRow<C extends CommandCandidate>
{
	item: CommandMatcherItem<C>;
	bucket: number;
	descriptionHits: number;
}

export interface CommandSearchOptions<C extends CommandCandidate>
{
	getScoreBoost?: ((candidate: C) => number) | undefined;
	filter?: ((candidate: C) => boolean) | undefined;
}

const PART_SEPARATOR = /[:_-]/g;
/* Description-only rows rank after every Fuse bucket (score * 10 < 10). */
const DESCRIPTION_BUCKET = 10;

function descriptionWords(description: string | undefined): string[]
{
	const words = new Set<string>();
	for (const word of (description ?? "").toLowerCase().split(/\s+/))
	{
		if (/[^a-z0-9]/.test(word))
		{
			words.add(word.replace(/[^a-z0-9]/g, ""));
			for (const part of word.split(/[^a-z0-9]+/)) words.add(part);
		}
		else words.add(word);
	}
	words.delete("");
	return [...words].toSorted();
}

/* How many distinct sorted words start with `prefix`, found by binary search. */
function countPrefixed(words: readonly string[], prefix: string): number
{
	let low = 0;
	let high = words.length;
	while (low < high)
	{
		const mid = (low + high) >>> 1;
		const word = words[mid];
		if (word !== undefined && word < prefix) low = mid + 1;
		else high = mid;
	}
	let hits = 0;
	while (words[low + hits]?.startsWith(prefix) === true) hits++;
	return hits;
}

export class CommandMatcher<C extends CommandCandidate = CommandCandidate>
{
	readonly items: CommandMatcherItem<C>[];
	private readonly fuse: Fuse<CommandMatcherItem<C>>;
	private lastSearch:
	{
		query: string;
		rows: MatchRow<C>[];
	} | null = null;

	constructor(candidates: readonly C[])
	{
		this.items = candidates.map((candidate) =>
		{
			const {name, displayName} = candidate;
			const parts = name.split(PART_SEPARATOR).filter(Boolean);
			const displayParts = displayName === name ? [] : displayName.split(PART_SEPARATOR).filter(Boolean);
			return {
				partKey: parts.length > 1 ? parts : undefined,
				displayPartKey: displayParts.length > 1 ? displayParts : undefined,
				commandName: name,
				displayName,
				candidate,
				aliasKey: candidate.aliases,
				descriptionWords: descriptionWords(candidate.description),
			};
		});
		this.fuse = new Fuse(
			this.items,
			{
				includeScore: true,
				threshold: 0.3,
				location: 0,
				distance: 100,
				keys: [
					{
						name: "commandName",
						weight: 3,
					},
					{
						name: "displayName",
						weight: 2,
					},
					{
						name: "partKey",
						weight: 2,
					},
					{
						name: "aliasKey",
						weight: 2,
					},
					{
						name: "displayPartKey",
						weight: 1,
					},
				],
			},
		);
	}

	search(rawQuery: string, options?: CommandSearchOptions<C>): C[]
	{
		const query = rawQuery.trim().toLowerCase();
		let rows = this.lastSearch?.query === query ? this.lastSearch.rows : undefined;
		if (rows === undefined)
		{
			rows = this.fuse.search(query).map((result) => (
			{
				item: result.item,
				bucket: Math.floor((result.score ?? 0) * 10),
				descriptionHits: 0,
			}));
			const prefix = query.replace(/[^a-z0-9]/g, "");
			if (prefix !== "")
			{
				const matched = new Set(rows.map((row) => row.item));
				for (const item of this.items)
				{
					if (matched.has(item)) continue;
					const hits = countPrefixed(item.descriptionWords, prefix);
					if (hits > 0)
						rows.push(
							{
								item,
								bucket: DESCRIPTION_BUCKET,
								descriptionHits: hits,
							},
						);
				}
			}
			this.lastSearch =
			{
				query,
				rows,
			};
		}
		const filter = options?.filter;
		const kept = filter === undefined ? rows : rows.filter((row) => filter(row.item.candidate));
		const boost = options?.getScoreBoost;
		const ranked = kept.map((row) =>
		{
			const name = row.item.commandName.toLowerCase();
			const display = row.item.displayName.toLowerCase();
			const aliases = row.item.aliasKey.map((alias) => alias.toLowerCase());
			const exact = name === query || display === query;
			const prefixAlias = aliases.find((alias) => alias.startsWith(query));
			const rankKey = [
				exact ? 0 : 1,
				aliases.includes(query) ? 0 : 1,
				Math.min(
					name.startsWith(query) ? name.length : Number.POSITIVE_INFINITY,
					display.startsWith(query) ? display.length : Number.POSITIVE_INFINITY,
				),
				prefixAlias === undefined ? Number.POSITIVE_INFINITY : prefixAlias.length,
				row.bucket,
				-row.descriptionHits,
				-(boost === undefined ? 0 : boost(row.item.candidate)),
			];
			return {
				candidate: row.item.candidate,
				rankKey,
			};
		});
		ranked.sort((a, b) =>
		{
			for (let i = 0; i < a.rankKey.length; i++)
			{
				const x = a.rankKey[i] ?? 0;
				const y = b.rankKey[i] ?? 0;
				if (x < y) return -1;
				if (x > y) return 1;
			}
			return 0;
		});
		return ranked.map((row) => row.candidate);
	}
}
