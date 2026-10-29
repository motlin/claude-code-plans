/** Upstream's `LSS-artifacts-gallery-layout`, minus the cloud store prefix. */
export const ARTIFACTS_LAYOUT_STORAGE_KEY = "artifacts-gallery-layout";

export type ArtifactsLayout = "list" | "grid";
export type ArtifactKind = "html" | "docs";
/** Upstream's type filter rows; the Slides/Design/Design System/Dashboard types never index locally, so they count 0. */
export type ArtifactTypeFilter = "all" | "slides" | "design" | "design-system" | "dashboard" | ArtifactKind;
/** Upstream's ownership tabs: All, Yours (you own it), Shared with you (any other audience). */
export type ArtifactView = "all" | "yours" | "shared";

const RECENT_DAYS = 7;

interface DatedArtifact {
	lastPublishedAt: number | null;
	firstSeenAt: number;
}

interface FilterableArtifact {
	title: string;
	kind: ArtifactKind;
}

export function readArtifactsLayout(): ArtifactsLayout {
	try {
		return localStorage.getItem(ARTIFACTS_LAYOUT_STORAGE_KEY) === "list" ? "list" : "grid";
	} catch {
		return "grid";
	}
}

export function writeArtifactsLayout(layout: ArtifactsLayout): void {
	try {
		localStorage.setItem(ARTIFACTS_LAYOUT_STORAGE_KEY, layout);
	} catch {
		// Storage can be unavailable (private mode); the toggle still works for this visit.
	}
}

/** The time a row is grouped and dated by: its last publish, else when it was first seen. */
export function artifactTimestamp(artifact: DatedArtifact): number {
	return artifact.lastPublishedAt ?? artifact.firstSeenAt;
}

/** Upstream's `ot` day starts: today's local midnight, then each of the previous six. */
function recentDayStarts(now: Date): number[] {
	return Array.from({length: RECENT_DAYS}, (_, index) =>
		new Date(now.getFullYear(), now.getMonth(), now.getDate() - index).getTime(),
	);
}

function dayLabel(index: number, dayStart: number): string {
	if (index === 0) return "Today";
	if (index === 1) return "Yesterday";
	return new Date(dayStart).toLocaleDateString("en-US", {month: "short", day: "numeric"});
}

function monthLabel(year: number, month: number, now: Date): string {
	return new Date(year, month, 1).toLocaleDateString("en-US", {
		month: "long",
		...(year === now.getFullYear() ? {} : {year: "numeric"}),
	});
}

/**
 * Upstream's gallery buckets: "Today", "Yesterday", then a day label ("Sep 26") within the last
 * week (anything later than today's midnight counts as Today), the month name for the rest of
 * the current year, then "Month YYYY".
 */
export function artifactDateGroupLabel(ms: number, now: Date): string {
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
): Array<{label: string; items: T[]}> {
	const dayStarts = recentDayStarts(now);
	const days: T[][] = dayStarts.map(() => []);
	const months = new Map<number, T[]>();
	const older: T[] = [];
	for (const item of items) {
		const ms = artifactTimestamp(item);
		if (!Number.isFinite(ms)) {
			older.push(item);
			continue;
		}
		const index = dayStarts.findIndex((dayStart) => ms >= dayStart);
		if (index !== -1) {
			days[index]?.push(item);
			continue;
		}
		const date = new Date(ms);
		const key = date.getFullYear() * 12 + date.getMonth();
		const bucket = months.get(key);
		if (bucket) bucket.push(item);
		else months.set(key, [item]);
	}
	const newestFirst = (bucket: T[]) => bucket.toSorted((a, b) => artifactTimestamp(b) - artifactTimestamp(a));
	const groups = days.flatMap((bucket, index) =>
		bucket.length === 0 ? [] : [{label: dayLabel(index, dayStarts[index] ?? 0), items: newestFirst(bucket)}],
	);
	for (const [key, bucket] of [...months].toSorted(([a], [b]) => b - a)) {
		groups.push({label: monthLabel(Math.floor(key / 12), key % 12, now), items: newestFirst(bucket)});
	}
	if (older.length > 0) groups.push({label: "Older", items: older});
	return groups;
}

/** The "Edited Sep 26" date: month and day this year, with the year otherwise. */
function formatArtifactDate(ms: number, now: Date): string {
	const date = new Date(ms);
	return date.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		...(date.getFullYear() === now.getFullYear() ? {} : {year: "numeric"}),
	});
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
/** Upstream's RelativeTime `absoluteAfterHours: 48`. */
const RELATIVE_HOURS = 48;

/** Upstream's RelativeTime (`relativeFormat: "narrow"`): "now", "5m ago", "14h ago" within 48h, else the date. */
export function formatArtifactRelative(ms: number, now: Date): string {
	const elapsed = now.getTime() - ms;
	if (elapsed >= 0 && elapsed < RELATIVE_HOURS * HOUR_MS) {
		if (elapsed < MINUTE_MS) return "now";
		if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m ago`;
		return `${Math.floor(elapsed / HOUR_MS)}h ago`;
	}
	return formatArtifactDate(ms, now);
}

/** The RelativeTime tooltip: "Oct 2, 2026, 8:19 PM EDT". */
export function formatArtifactTooltip(ms: number): string {
	return new Date(ms).toLocaleString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "numeric",
		minute: "2-digit",
		timeZoneName: "short",
	});
}

export function artifactMatchesSearch(title: string, search: string): boolean {
	const needle = search.trim().toLowerCase();
	return needle === "" || title.toLowerCase().includes(needle);
}

export function artifactInView(audience: string | null, view: ArtifactView): boolean {
	if (view === "all") return true;
	return (audience === "owner") === (view === "yours");
}

export function filterArtifacts<T extends FilterableArtifact>(
	items: readonly T[],
	{search, type}: {search: string; type: ArtifactTypeFilter},
): T[] {
	return items.filter((item) => (type === "all" || item.kind === type) && artifactMatchesSearch(item.title, search));
}
