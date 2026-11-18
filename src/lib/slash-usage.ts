/*
 * Upstream's slash usage store (`mt` reads, `tA` records, keyed by account): how often each skill was picked from the
 * grouped "/" menu, which boosts typed-query ranking. Upstream keys it by account uuid; locally there is one account.
 * Only the grouped menu (`COMPACT_SLASH_MENU_HOST`) reads or writes it.
 */
import {z} from "zod";

const STORAGE_PREFIX = "slash-command-skill-usage:";
/* A repeat pick within this long counts once. */
const THROTTLE_MS = 60_000;
const DAY_MS = 86_400_000;
const HALF_LIFE_DAYS = 7;
const MIN_DECAY = 0.1;

/* Lenient at runtime: a malformed store reads as empty rather than throwing. */
const UsageStoreSchema = z.record(
	z.string(),
	z.object(
		{
			usageCount: z.number(),
			lastUsedAt: z.number(),
		},
	),
);

type UsageStore = z.infer<typeof UsageStoreSchema>;

const lastRecorded = new Map<string, number>();

/** Test hook: forgets the in-memory throttle. */
export function resetSlashUsageThrottle(): void
{
	lastRecorded.clear();
}

function readStore(account: string): UsageStore
{
	try
	{
		const raw = localStorage.getItem(STORAGE_PREFIX + account);
		const parsed = UsageStoreSchema.safeParse(raw === null ? null : JSON.parse(raw));
		return parsed.success ? parsed.data : {};
	}
	catch
	{
		return {};
	}
}

/** Records one pick of `usageKey`, at most once a minute per key. */
export function recordSlashUsage(account: string, usageKey: string): void
{
	const now = Date.now();
	const throttleKey = `${account}\0${usageKey}`;
	const last = lastRecorded.get(throttleKey);
	if (last !== undefined && now - last < THROTTLE_MS) return;
	lastRecorded.set(throttleKey, now);
	const store = readStore(account);
	store[usageKey] =
	{
		usageCount: (store[usageKey]?.usageCount ?? 0) + 1,
		lastUsedAt: now,
	};
	try
	{
		localStorage.setItem(STORAGE_PREFIX + account, JSON.stringify(store));
	}
	catch
	{
		// Storage blocked or full: the pick just isn't remembered.
	}
}

/** The score boost for a usage key: its pick count, halved every week since its last pick, floored at a tenth. */
export function slashUsageScores(account: string): (usageKey: string) => number
{
	const store = readStore(account);
	return (usageKey) =>
	{
		const entry = store[usageKey];
		if (entry === undefined) return 0;
		const ageDays = (Date.now() - entry.lastUsedAt) / DAY_MS;
		return entry.usageCount * Math.max(0.5 ** (ageDays / HALF_LIFE_DAYS), MIN_DECAY);
	};
}

/** The one local account the usage store is keyed by (upstream keys it by account uuid). */
export const SLASH_USAGE_ACCOUNT = "local";
