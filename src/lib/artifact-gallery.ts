/** Upstream's `LSS-artifacts-gallery-layout`, minus the cloud store prefix. */
export const ARTIFACTS_LAYOUT_STORAGE_KEY = "artifacts-gallery-layout";

export type ArtifactsLayout = "list" | "grid";
export type ArtifactKind = "html" | "docs";
/** Upstream's ownership tabs: All, Yours (you own it), Shared with you (any other audience). */
export type ArtifactView = "all" | "yours" | "shared";

const RECENT_DAYS = 7;

interface DatedArtifact
{
	lastPublishedAt: number | null;
	firstSeenAt: number;
}

export function readArtifactsLayout(): ArtifactsLayout
{
	try
	{
		return localStorage.getItem(ARTIFACTS_LAYOUT_STORAGE_KEY) === "list" ? "list" : "grid";
	}
	catch
	{
		return "grid";
	}
}

export function writeArtifactsLayout(layout: ArtifactsLayout): void
{
	try
	{
		localStorage.setItem(ARTIFACTS_LAYOUT_STORAGE_KEY, layout);
	}
	catch
	{
		// Storage can be unavailable (private mode); the toggle still works for this visit.
	}
}

/** The time a row is grouped and dated by: its last publish, else when it was first seen. */
export function artifactTimestamp(artifact: DatedArtifact): number
{
	return artifact.lastPublishedAt ?? artifact.firstSeenAt;
}

/** Upstream's `ot` day starts: today's local midnight, then each of the previous six. */
function recentDayStarts(now: Date): number[]
{
	return Array.from(
		{
			length: RECENT_DAYS,
		},
		(_, index) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - index).getTime(),
	);
}

function dayLabel(index: number, dayStart: number): string
{
	if (index === 0) return "Today";
	if (index === 1) return "Yesterday";
	return new Date(dayStart).toLocaleDateString(
		"en-US",
		{
			month: "short",
			day: "numeric",
		},
	);
}

function monthLabel(year: number, month: number, now: Date): string
{
	return new Date(year, month, 1).toLocaleDateString(
		"en-US",
		{
			month: "long",
			...(year === now.getFullYear()
				? {}
				:
					{
						year: "numeric",
					}),
		},
	);
}

/**
 * Upstream's gallery buckets: "Today", "Yesterday", then a day label ("Sep 26") within the last
 * week (anything later than today's midnight counts as Today), the month name for the rest of
 * the current year, then "Month YYYY".
 */
export function artifactDateGroupLabel(ms: number, now: Date): string
{
	const dayStarts = recentDayStarts(now);
	const index = dayStarts.findIndex((dayStart) => ms >= dayStart);
	if (index !== -1) return dayLabel(index, dayStarts[index] ?? ms);
	const date = new Date(ms);
	return monthLabel(date.getFullYear(), date.getMonth(), now);
}

/**
 * Upstream's `ot`: seven day buckets, then month buckets newest first, then a trailing "Older"
 * bucket for items without a usable timestamp. Each bucket is sorted newest first.
 */
export function groupArtifactsByDate<T extends DatedArtifact>(
	items: readonly T[],
	now: Date,
	timestamp: (item: T) => number = artifactTimestamp,
): Array<
{
	label: string;
	items: T[];
}>
{
	const dayStarts = recentDayStarts(now);
	const days: T[][] = dayStarts.map(() => []);
	const months = new Map<number, T[]>();
	const older: T[] = [];
	for (const item of items)
	{
		const ms = timestamp(item);
		if (!Number.isFinite(ms))
		{
			older.push(item);
			continue;
		}
		const index = dayStarts.findIndex((dayStart) => ms >= dayStart);
		if (index !== -1)
		{
			days[index]?.push(item);
			continue;
		}
		const date = new Date(ms);
		const key = date.getFullYear() * 12 + date.getMonth();
		const bucket = months.get(key);
		if (bucket) bucket.push(item);
		else months.set(key, [item]);
	}
	const newestFirst = (bucket: T[]) => bucket.toSorted((a, b) => timestamp(b) - timestamp(a));
	const groups = days.flatMap((bucket, index) =>
		bucket.length === 0
			? []
			: [
					{
						label: dayLabel(index, dayStarts[index] ?? 0),
						items: newestFirst(bucket),
					},
				],
	);
	for (const [key, bucket] of [...months].toSorted(([a], [b]) => b - a))
	{
		groups.push(
			{
				label: monthLabel(Math.floor(key / 12), key % 12, now),
				items: newestFirst(bucket),
			},
		);
	}
	if (older.length > 0)
		groups.push(
			{
				label: "Older",
				items: older,
			},
		);
	return groups;
}

/** The "Edited Sep 26" date: month and day this year, with the year otherwise. */
function formatArtifactDate(ms: number, now: Date): string
{
	const date = new Date(ms);
	return date.toLocaleDateString(
		"en-US",
		{
			month: "short",
			day: "numeric",
			...(date.getFullYear() === now.getFullYear()
				? {}
				:
					{
						year: "numeric",
					}),
		},
	);
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
/** Upstream's RelativeTime `absoluteAfterHours: 48`. */
const RELATIVE_HOURS = 48;

/** Upstream's RelativeTime (`relativeFormat: "narrow"`): "now", "5m ago", "14h ago" within 48h, else the date. */
export function formatArtifactRelative(ms: number, now: Date): string
{
	const elapsed = now.getTime() - ms;
	if (elapsed >= 0 && elapsed < RELATIVE_HOURS * HOUR_MS)
	{
		if (elapsed < MINUTE_MS) return "now";
		if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m ago`;
		return `${Math.floor(elapsed / HOUR_MS)}h ago`;
	}
	return formatArtifactDate(ms, now);
}

/** The RelativeTime tooltip: "Oct 2, 2026, 8:19 PM EDT". */
export function formatArtifactTooltip(ms: number): string
{
	return new Date(ms).toLocaleString(
		"en-US",
		{
			month: "short",
			day: "numeric",
			year: "numeric",
			hour: "numeric",
			minute: "2-digit",
			timeZoneName: "short",
		},
	);
}

export function artifactMatchesSearch(title: string, search: string): boolean
{
	const needle = search.trim().toLowerCase();
	return needle === "" || title.toLowerCase().includes(needle);
}

export function artifactInView(audience: string | null, view: ArtifactView): boolean
{
	if (view === "all") return true;
	return (audience === "owner") === (view === "yours");
}

/** Upstream's Sort by: "Last opened" (the default) or "Last edited". */
export type ArtifactSort = "opened" | "edited";

interface OpenedArtifact extends DatedArtifact
{
	lastOpenedAt: number | null;
}

/** The "Last opened" time: the latest local open/read, else the last publish, else first seen. */
export function artifactOpenedTimestamp(artifact: OpenedArtifact): number
{
	return artifact.lastOpenedAt ?? artifactTimestamp(artifact);
}

export function artifactSortTimestamp(artifact: OpenedArtifact, sort: ArtifactSort): number
{
	return sort === "opened" ? artifactOpenedTimestamp(artifact) : artifactTimestamp(artifact);
}

/** Newest first by the picked sort's time. */
export function sortArtifacts<T extends OpenedArtifact>(items: readonly T[], sort: ArtifactSort): T[]
{
	return items.toSorted((a, b) => artifactSortTimestamp(b, sort) - artifactSortTimestamp(a, sort));
}

/** Upstream's Type submenu rows, alphabetical, then Other (every non-Docs local publish). */
export const ARTIFACT_TYPE_KEYS = ["dashboard", "design", "design-system", "docs", "slides", "other"] as const;
export type ArtifactTypeKey = (typeof ARTIFACT_TYPE_KEYS)[number];
export const ARTIFACT_OWNERS = ["me", "others"] as const;
export type ArtifactOwner = (typeof ARTIFACT_OWNERS)[number];
/** Upstream's Date opened radios: Any time / Today / Yesterday / Past 7 days / Past 30 days. */
export const ARTIFACT_OPENED_RANGES = ["any", "today", "yesterday", "week", "month"] as const;
export type ArtifactOpenedRange = (typeof ARTIFACT_OPENED_RANGES)[number];
/** Upstream's Sharing radios: Any / Only you / Shared. */
export const ARTIFACT_SHARINGS = ["any", "private", "shared"] as const;
export type ArtifactSharing = (typeof ARTIFACT_SHARINGS)[number];

export interface ArtifactFilters
{
	types: readonly ArtifactTypeKey[];
	owners: readonly ArtifactOwner[];
	opened: ArtifactOpenedRange;
	sharing: ArtifactSharing;
	pinned: boolean;
}

export const NO_ARTIFACT_FILTERS: ArtifactFilters =
{
	types: [],
	owners: [],
	opened: "any",
	sharing: "any",
	pinned: false,
};

/** The trigger's "{n} filters on": each type and owner pick, a non-Any date or sharing, and Pinned. */
export function activeFilterCount(filters: ArtifactFilters): number
{
	return (
		filters.types.length +
		filters.owners.length +
		(filters.opened === "any" ? 0 : 1) +
		(filters.sharing === "any" ? 0 : 1) +
		(filters.pinned ? 1 : 0)
	);
}

export function artifactTypeKey(kind: ArtifactKind): ArtifactTypeKey
{
	return kind === "docs" ? "docs" : "other";
}

/** Each Date opened range's [days back to its first local midnight, days back to its end midnight]; null is open-ended. */
const OPENED_RANGE_DAYS: Record<Exclude<ArtifactOpenedRange, "any">, readonly [number, number | null]> =
{
	today: [0, null],
	yesterday: [1, 0],
	week: [RECENT_DAYS - 1, null],
	month: [29, null],
};

/** Whether the artifact's opened time falls in the range, with local-midnight day boundaries. */
function openedInRange(ms: number, range: ArtifactOpenedRange, now: Date): boolean
{
	if (range === "any") return true;
	const dayStart = (daysAgo: number) =>
		new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo).getTime();
	const [from, to] = OPENED_RANGE_DAYS[range];
	return ms >= dayStart(from) && (to === null || ms < dayStart(to));
}

interface FilteredArtifact extends OpenedArtifact
{
	kind: ArtifactKind;
	audience: string | null;
}

/** The Filter and sort menu's picks; locally Owner and Sharing both read the indexed audience. */
export function applyArtifactFilters<T extends FilteredArtifact>(
	items: readonly T[],
	filters: ArtifactFilters,
	{
		now,
		isPinned,
	}:
	{
		now: Date;
		isPinned: (item: T) => boolean;
	},
): T[]
{
	return items.filter((item) =>
	{
		const mine = item.audience === "owner";
		if (filters.types.length > 0 && !filters.types.includes(artifactTypeKey(item.kind))) return false;
		if (filters.owners.length > 0 && !filters.owners.includes(mine ? "me" : "others")) return false;
		if (!openedInRange(artifactOpenedTimestamp(item), filters.opened, now)) return false;
		if (filters.sharing !== "any" && mine !== (filters.sharing === "private")) return false;
		return !filters.pinned || isPinned(item);
	});
}
