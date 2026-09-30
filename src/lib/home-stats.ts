import {isCountableMessageRecord} from "./message-count";
import {SYNTHETIC_MODEL} from "./model-name";

/**
 * The home empty state's usage stats card: the local counterpart of the CLI
 * `/stats` numbers claude.ai/code shows when nothing needs attention.
 *
 * Isomorphic: no Node-specific imports.
 */

export const HOME_STATS_RANGES = ["all", "30d", "7d"] as const;
export type HomeStatsRange = (typeof HOME_STATS_RANGES)[number];

export const HOME_STATS_RANGE_LABELS = {
	all: "All",
	"30d": "30d",
	"7d": "7d",
} as const satisfies Record<HomeStatsRange, string>;

const RANGE_DAYS = {"30d": 30, "7d": 7} as const satisfies Record<Exclude<HomeStatsRange, "all">, number>;

/** The widest heatmap "All" draws: 52 weeks. */
const MAX_HEATMAP_DAYS = 364;

/** One local calendar day of activity. */
export interface HomeStatsDay {
	/** Local `YYYY-MM-DD`. */
	date: string;
	/** Sessions started that day. */
	sessions: number;
	messages: number;
	/** Sessions started in each local hour 0-23. */
	hourCounts: number[];
	/** Input + output tokens per raw model id; null when no source knows that day's tokens. */
	tokensByModel: Record<string, number> | null;
}

export interface HomeStatsModelRow {
	model: string;
	tokens: number;
	share: number;
}

export interface HomeStatsHeatmapCell {
	date: string;
	/** Messages that day. */
	value: number;
}

export interface HomeStats {
	sessions: number;
	messages: number;
	totalTokens: number | null;
	activeDays: number;
	peakHour: number | null;
	favoriteModel: string | null;
	models: HomeStatsModelRow[];
	heatmap: HomeStatsHeatmapCell[];
}

function parseDate(date: string): number {
	const [year, month, dayOfMonth] = date.split("-").map(Number);
	return Date.UTC(year ?? 1970, (month ?? 1) - 1, dayOfMonth ?? 1);
}

function formatDate(utcMs: number): string {
	return new Date(utcMs).toISOString().slice(0, 10);
}

const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(date: string, days: number): string {
	return formatDate(parseDate(date) + days * DAY_MS);
}

/** Local `YYYY-MM-DD` for a moment. */
export function localDateKey(at: Date): string {
	const year = at.getFullYear();
	const month = String(at.getMonth() + 1).padStart(2, "0");
	const dayOfMonth = String(at.getDate()).padStart(2, "0");
	return `${year}-${month}-${dayOfMonth}`;
}

function rangeStart(days: readonly HomeStatsDay[], range: HomeStatsRange, today: string): string {
	if (range !== "all") return addDays(today, 1 - RANGE_DAYS[range]);
	const earliestCap = addDays(today, 1 - MAX_HEATMAP_DAYS);
	const firstActive = days
		.filter((row) => row.sessions > 0 || row.messages > 0)
		.map((row) => row.date)
		.sort()[0];
	if (firstActive === undefined || firstActive > today) return today;
	return firstActive < earliestCap ? earliestCap : firstActive;
}

function maxBy<T>(entries: readonly T[], value: (entry: T) => number): T | undefined {
	let best: T | undefined;
	let bestValue = 0;
	for (const entry of entries) {
		const candidate = value(entry);
		if (candidate > bestValue) {
			best = entry;
			bestValue = candidate;
		}
	}
	return best;
}

/**
 * The card's numbers for one range. "All" totals every day; 7d and 30d total
 * the trailing window ending `today`. Ties go to the earlier hour and to the
 * alphabetically first model id so the tiles never flicker.
 */
export function computeHomeStats(days: readonly HomeStatsDay[], range: HomeStatsRange, today: string): HomeStats {
	const windowStart = range === "all" ? undefined : rangeStart(days, range, today);
	const inRange = days.filter((row) => row.date <= today && (windowStart === undefined || row.date >= windowStart));

	let sessions = 0;
	let messages = 0;
	let activeDays = 0;
	let hasTokens = false;
	const hourCounts = Array.from({length: 24}, () => 0);
	const modelTokens = new Map<string, number>();
	for (const row of inRange) {
		sessions += row.sessions;
		messages += row.messages;
		if (row.sessions > 0 || row.messages > 0) activeDays++;
		row.hourCounts.forEach((count, hour) => {
			if (hour < 24) hourCounts[hour] = (hourCounts[hour] ?? 0) + count;
		});
		if (row.tokensByModel !== null) {
			for (const [model, tokens] of Object.entries(row.tokensByModel)) {
				hasTokens = true;
				modelTokens.set(model, (modelTokens.get(model) ?? 0) + tokens);
			}
		}
	}

	const totalTokens = hasTokens ? [...modelTokens.values()].reduce((a, b) => a + b, 0) : null;
	const models = [...modelTokens]
		.filter(([, tokens]) => tokens > 0)
		.sort(([a, aTokens], [b, bTokens]) => bTokens - aTokens || (a < b ? -1 : a > b ? 1 : 0))
		.map(([model, tokens]) => ({model, tokens, share: totalTokens ? tokens / totalTokens : 0}));

	const peak = maxBy(
		hourCounts.map((count, hour) => ({count, hour})),
		(entry) => entry.count,
	);

	const byDate = new Map(inRange.map((row) => [row.date, row.messages]));
	const heatmap: HomeStatsHeatmapCell[] = [];
	for (let date = rangeStart(days, range, today); date <= today; date = addDays(date, 1)) {
		heatmap.push({date, value: byDate.get(date) ?? 0});
	}

	return {
		sessions,
		messages,
		totalTokens,
		activeDays,
		peakHour: peak?.hour ?? null,
		favoriteModel: models[0]?.model ?? null,
		models,
		heatmap,
	};
}

export function formatPeakHour(hour: number): string {
	const suffix = hour < 12 ? "AM" : "PM";
	const clock = hour % 12 === 0 ? 12 : hour % 12;
	return `${clock} ${suffix}`;
}

const COMPACT = new Intl.NumberFormat("en-US", {
	notation: "compact",
	maximumFractionDigits: 1,
});

export function formatTokenCount(tokens: number): string {
	return COMPACT.format(tokens);
}

/** The fields of `~/.claude/stats-cache.json` the card reads. */
export interface StatsCacheTokens {
	lastComputedDate: string;
	dailyModelTokens: ReadonlyArray<{date: string; tokensByModel: Record<string, number>}>;
}

/** The CLI recomputes its cache daily, so it is fresh when it covers yesterday. */
function isStatsCacheFresh(cache: StatsCacheTokens, today: string): boolean {
	return cache.lastComputedDate >= addDays(today, -1);
}

/**
 * Prefers the CLI's own per-day token totals (what `/stats` shows) for the days
 * a fresh stats cache lists, keeping the index's totals everywhere else.
 */
export function mergeStatsCacheTokens(
	days: readonly HomeStatsDay[],
	cache: StatsCacheTokens | null,
	today: string,
): HomeStatsDay[] {
	if (cache === null || !isStatsCacheFresh(cache, today)) return [...days];
	const merged = new Map(days.map((row) => [row.date, row]));
	for (const {date, tokensByModel} of cache.dailyModelTokens) {
		const existing = merged.get(date);
		merged.set(date, {
			date,
			sessions: existing?.sessions ?? 0,
			messages: existing?.messages ?? 0,
			hourCounts: existing?.hourCounts ?? Array.from({length: 24}, () => 0),
			tokensByModel: {...tokensByModel},
		});
	}
	return [...merged.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** One `usage_daily` row: a transcript's messages and token usage for a local day and model. */
export interface UsageDailyRow {
	day: string;
	/** Null for messages no model produced (user turns, synthetic replays). */
	model: string | null;
	messages: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheCreationTokens: number;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function tokenCount(usage: Record<string, unknown>, key: string): number {
	const value = usage[key];
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Aggregates transcript records into per-day, per-model usage. Claude Code
 * splits one API response into a record per content block, each repeating the
 * same `message.usage`, so usage counts once per `message.id`.
 */
export class UsageCollector {
	private readonly totals = new Map<string, UsageDailyRow>();
	private readonly seenMessageIds = new Set<string>();

	add(record: unknown): void {
		const obj = asRecord(record);
		if (obj === undefined) return;
		const timestamp = obj["timestamp"];
		if (typeof timestamp !== "string") return;
		const at = new Date(timestamp);
		if (Number.isNaN(at.getTime())) return;
		const day = localDateKey(at);

		const message = asRecord(obj["message"]);
		const rawModel = obj["type"] === "assistant" ? message?.["model"] : undefined;
		const model = typeof rawModel === "string" && rawModel !== SYNTHETIC_MODEL ? rawModel : null;
		const countable = isCountableMessageRecord(obj);

		const usage = model === null ? undefined : asRecord(message?.["usage"]);
		const messageId = message?.["id"];
		const freshUsage =
			usage !== undefined && (typeof messageId !== "string" || !this.seenMessageIds.has(messageId));
		if (!countable && !freshUsage) return;
		if (freshUsage && typeof messageId === "string") this.seenMessageIds.add(messageId);

		const key = `${day}\u0000${model ?? ""}`;
		const row = this.totals.get(key) ?? {
			day,
			model,
			messages: 0,
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheCreationTokens: 0,
		};
		if (countable) row.messages++;
		if (freshUsage && usage !== undefined) {
			row.inputTokens += tokenCount(usage, "input_tokens");
			row.outputTokens += tokenCount(usage, "output_tokens");
			row.cacheReadTokens += tokenCount(usage, "cache_read_input_tokens");
			row.cacheCreationTokens += tokenCount(usage, "cache_creation_input_tokens");
		}
		this.totals.set(key, row);
	}

	rows(): UsageDailyRow[] {
		return [...this.totals.values()].sort(
			(a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0) || (a.model ?? "").localeCompare(b.model ?? ""),
		);
	}
}
