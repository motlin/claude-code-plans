/** Upstream's `LSS-artifacts-gallery-layout`, minus the cloud store prefix. */
export const ARTIFACTS_LAYOUT_STORAGE_KEY = "artifacts-gallery-layout";

export type ArtifactsLayout = "list" | "grid";
export type ArtifactKind = "html" | "docs";
export type ArtifactTypeFilter = "all" | ArtifactKind;

const DAY_MS = 24 * 60 * 60 * 1000;
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
		return localStorage.getItem(ARTIFACTS_LAYOUT_STORAGE_KEY) === "grid" ? "grid" : "list";
	} catch {
		return "list";
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

function startOfDay(date: Date): number {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * Upstream's gallery buckets: a day label ("Sep 26") within the last week, the month name for
 * the rest of the current year, then "Month YYYY".
 */
export function artifactDateGroupLabel(ms: number, now: Date): string {
	const date = new Date(ms);
	const daysAgo = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
	if (daysAgo >= 0 && daysAgo < RECENT_DAYS) {
		return date.toLocaleDateString("en-US", {month: "short", day: "numeric"});
	}
	if (date.getFullYear() === now.getFullYear()) {
		return date.toLocaleDateString("en-US", {month: "long"});
	}
	return date.toLocaleDateString("en-US", {month: "long", year: "numeric"});
}

/** Groups already-sorted artifacts into consecutive date buckets. */
export function groupArtifactsByDate<T extends DatedArtifact>(
	items: readonly T[],
	now: Date,
): Array<{label: string; items: T[]}> {
	const groups: Array<{label: string; items: T[]}> = [];
	for (const item of items) {
		const label = artifactDateGroupLabel(artifactTimestamp(item), now);
		const last = groups.at(-1);
		if (last?.label === label) last.items.push(item);
		else groups.push({label, items: [item]});
	}
	return groups;
}

/** The "Edited Sep 26" date: month and day this year, with the year otherwise. */
export function formatArtifactDate(ms: number, now: Date): string {
	const date = new Date(ms);
	return date.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		...(date.getFullYear() === now.getFullYear() ? {} : {year: "numeric"}),
	});
}

export function artifactMatchesSearch(title: string, search: string): boolean {
	const needle = search.trim().toLowerCase();
	return needle === "" || title.toLowerCase().includes(needle);
}

export function filterArtifacts<T extends FilterableArtifact>(
	items: readonly T[],
	{search, type}: {search: string; type: ArtifactTypeFilter},
): T[] {
	return items.filter((item) => (type === "all" || item.kind === type) && artifactMatchesSearch(item.title, search));
}
