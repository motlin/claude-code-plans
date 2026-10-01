import type {DiscoverPlugin} from "../../lib/api/customize";
import {type MenuOption, matchesQuery} from "./sections";

const compactFormat = new Intl.NumberFormat("en-US", {
	notation: "compact",
	maximumFractionDigits: 1,
});
const exactFormat = new Intl.NumberFormat("en-US");

/** Upstream card meta: 8,340,370 → "8.3M". */
export function formatInstallCount(count: number): string {
	return compactFormat.format(count);
}

/** The card tooltip: "8,340,370 installs". */
export function formatExactInstalls(count: number): string {
	return `${exactFormat.format(count)} ${count === 1 ? "install" : "installs"}`;
}

const STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

/** The CLI refreshes plugin-catalog-cache.json itself; warn once it is over 14 days old. */
export function isCatalogStale(fetchedAt: string | null, now: number): boolean {
	if (fetchedAt === null) return false;
	const fetched = Date.parse(fetchedAt);
	return !Number.isNaN(fetched) && now - fetched > STALE_AFTER_MS;
}

/** Skills Discover only offers plugins that ship at least one skill. */
export function discoverForSection(
	plugins: readonly DiscoverPlugin[],
	section: "skills" | "plugins",
): DiscoverPlugin[] {
	return section === "skills" ? plugins.filter((plugin) => plugin.skills.length > 0) : [...plugins];
}

/** Highest `unique_installs` first; plugins without a count are left out. */
export function mostInstalled(plugins: readonly DiscoverPlugin[], limit: number): DiscoverPlugin[] {
	return plugins
		.filter((plugin) => plugin.installs !== null)
		.sort((a, b) => (b.installs ?? 0) - (a.installs ?? 0) || a.name.localeCompare(b.name))
		.slice(0, limit);
}

/** Newest `last_updated` first; plugins without a date are left out. */
export function recentlyUpdated(plugins: readonly DiscoverPlugin[], limit: number): DiscoverPlugin[] {
	const time = (plugin: DiscoverPlugin) => Date.parse(plugin.lastUpdated ?? "");
	return plugins
		.filter((plugin) => !Number.isNaN(time(plugin)))
		.sort((a, b) => time(b) - time(a) || a.name.localeCompare(b.name))
		.slice(0, limit);
}

export interface CategoryCount {
	category: string;
	count: number;
}

/** Category chips, most plugins first, then alphabetical. */
export function categoryCounts(plugins: readonly DiscoverPlugin[]): CategoryCount[] {
	const counts = new Map<string, number>();
	for (const plugin of plugins) {
		if (plugin.category === null) continue;
		counts.set(plugin.category, (counts.get(plugin.category) ?? 0) + 1);
	}
	return [...counts]
		.map(([category, count]) => ({category, count}))
		.sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
}

export function categoryLabel(category: string): string {
	return category.charAt(0).toUpperCase() + category.slice(1);
}

export const ALL_CATEGORIES = "all";

/** Upstream Discover Filter: "All categories" first, then each category by plugin count. */
export function discoverCategoryOptions(plugins: readonly DiscoverPlugin[]): MenuOption[] {
	return [
		{value: ALL_CATEGORIES, label: "All categories"},
		...categoryCounts(plugins).map(({category}) => ({value: category, label: categoryLabel(category)})),
	];
}

/** Upstream Discover Sort; the first option is the default. */
export const DISCOVER_SORT_OPTIONS: readonly MenuOption[] = [
	{value: "installs", label: "Most installed"},
	{value: "recent", label: "Recently added"},
	{value: "name", label: "Name"},
];

/** Plugins in `category` (case-insensitive); everything for "all" or no category. */
export function filterDiscover(plugins: readonly DiscoverPlugin[], category: string | undefined): DiscoverPlugin[] {
	if (category === undefined || category === ALL_CATEGORIES) return [...plugins];
	const wanted = category.toLowerCase();
	return plugins.filter((plugin) => plugin.category?.toLowerCase() === wanted);
}

/**
 * The filtered grid's order: "recent" is newest `last_updated` first, "name"
 * is by title, and anything else is most installed first. Plugins missing the
 * sort key go last, by name.
 */
export function sortDiscover(plugins: readonly DiscoverPlugin[], sort: string | undefined): DiscoverPlugin[] {
	const byName = (a: DiscoverPlugin, b: DiscoverPlugin) => a.title.localeCompare(b.title);
	if (sort === "name") return [...plugins].sort(byName);
	const key =
		sort === "recent"
			? (plugin: DiscoverPlugin) => {
					const time = Date.parse(plugin.lastUpdated ?? "");
					return Number.isNaN(time) ? -Infinity : time;
				}
			: (plugin: DiscoverPlugin) => plugin.installs ?? -Infinity;
	return [...plugins].sort((a, b) => {
		const ka = key(a);
		const kb = key(b);
		return ka === kb ? byName(a, b) : kb - ka;
	});
}

/**
 * Upstream search results: "Yours N" (what you already have that matches) and
 * "More you can add N" (matching catalog plugins not yet installed, most
 * installed first).
 */
export function groupDiscoverSearch<T>(
	yours: readonly T[],
	yoursFields: (item: T) => readonly string[],
	catalog: readonly DiscoverPlugin[],
	q: string,
): {yours: T[]; more: DiscoverPlugin[]} {
	return {
		yours: yours.filter((item) => matchesQuery(q, ...yoursFields(item))),
		more: catalog
			.filter(
				(plugin) =>
					!plugin.installed &&
					matchesQuery(
						q,
						plugin.name,
						plugin.title,
						plugin.description,
						plugin.category ?? "",
						...plugin.skills,
					),
			)
			.sort((a, b) => (b.installs ?? -1) - (a.installs ?? -1) || a.name.localeCompare(b.name)),
	};
}
