import {FIVE_HOUR_LABEL, formatResetLabel, type RateLimitWindow, WEEKLY_LABEL} from "./composer-state";
import {formatModelName, SYNTHETIC_MODEL} from "./model-name";
import {formatUsd} from "./session-cost";

/** USD per million tokens. Cache writes are 1.25× input for the 5-minute TTL and 2× for the 1-hour TTL. */
export interface ModelPricing {
	input: number;
	output: number;
	cacheRead: number;
}

const CACHE_WRITE_5M = 1.25;
const CACHE_WRITE_1H = 2;

/** First-party API list prices, keyed by `formatModelName` output. */
const PRICING: Readonly<Record<string, ModelPricing>> = {
	"Fable 5.1": {input: 10, output: 50, cacheRead: 0.25},
	"Fable 5": {input: 10, output: 50, cacheRead: 1},
	"Mythos 5.1": {input: 10, output: 50, cacheRead: 0.25},
	"Opus 5.5": {input: 4, output: 20, cacheRead: 0.2},
	"Opus 5": {input: 5, output: 25, cacheRead: 0.5},
	"Opus 4.8": {input: 5, output: 25, cacheRead: 0.5},
	"Opus 4.7": {input: 5, output: 25, cacheRead: 0.5},
	"Opus 4.6": {input: 5, output: 25, cacheRead: 0.5},
	"Opus 4.5": {input: 5, output: 25, cacheRead: 0.5},
	"Opus 4.1": {input: 15, output: 75, cacheRead: 1.5},
	"Opus 4": {input: 15, output: 75, cacheRead: 1.5},
	"Sonnet 5": {input: 2, output: 10, cacheRead: 0.2},
	"Sonnet 4.6": {input: 3, output: 15, cacheRead: 0.3},
	"Sonnet 4.5": {input: 3, output: 15, cacheRead: 0.3},
	"Sonnet 4": {input: 3, output: 15, cacheRead: 0.3},
	"Haiku 4.5": {input: 1, output: 5, cacheRead: 0.1},
};

export function modelPricing(model: string): ModelPricing | null {
	return PRICING[model] ?? null;
}

export interface ModelUsageTotals {
	/** Display name, e.g. `Opus 5.5`. */
	model: string;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	/** Null when the model has no known price. */
	costUSD: number | null;
}

export interface SessionUsageBreakdown {
	/** Most expensive first. */
	models: ModelUsageTotals[];
	costUSD: number;
	/** Some model had no known price, so `costUSD` undercounts. */
	hasUnknownModelCost: boolean;
	/** `cache_read / (input + cache_read + cache_creation)`, or null with no input at all. */
	cacheHitRatio: number | null;
}

type RecordLike = Record<string, unknown>;

function isRecord(value: unknown): value is RecordLike {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function count(source: unknown, key: string): number {
	if (!isRecord(source)) return 0;
	const value = source[key];
	return typeof value === "number" ? value : 0;
}

interface Accumulator {
	totals: ModelUsageTotals;
	/** Cost in millionths of a dollar, so rounding happens once. */
	microUSD: number;
}

/**
 * Per-model token totals and cost over a session's assistant `usage` records.
 * Claude Code writes one record per content block, each repeating the
 * message's usage, so each `message.id` counts once.
 */
export function aggregateSessionUsage(records: readonly unknown[]): SessionUsageBreakdown {
	const seen = new Set<string>();
	const byModel = new Map<string, Accumulator>();
	for (const record of records) {
		if (!isRecord(record) || record["type"] !== "assistant") continue;
		const message = record["message"];
		if (!isRecord(message) || !isRecord(message["usage"])) continue;
		const rawModel = message["model"];
		if (typeof rawModel !== "string" || rawModel === SYNTHETIC_MODEL) continue;
		const model = formatModelName(rawModel);
		if (model === null) continue;
		const id = message["id"];
		if (typeof id === "string") {
			if (seen.has(id)) continue;
			seen.add(id);
		}
		const usage = message["usage"];
		const input = count(usage, "input_tokens");
		const output = count(usage, "output_tokens");
		const cacheRead = count(usage, "cache_read_input_tokens");
		const cacheWrite = count(usage, "cache_creation_input_tokens");
		const write1h = Math.min(cacheWrite, count(usage["cache_creation"], "ephemeral_1h_input_tokens"));

		let entry = byModel.get(model);
		if (entry === undefined) {
			entry = {
				totals: {
					model,
					inputTokens: 0,
					outputTokens: 0,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					costUSD: null,
				},
				microUSD: 0,
			};
			byModel.set(model, entry);
		}
		entry.totals.inputTokens += input;
		entry.totals.outputTokens += output;
		entry.totals.cacheReadTokens += cacheRead;
		entry.totals.cacheWriteTokens += cacheWrite;
		const price = modelPricing(model);
		if (price !== null) {
			entry.microUSD +=
				input * price.input +
				output * price.output +
				cacheRead * price.cacheRead +
				(cacheWrite - write1h) * price.input * CACHE_WRITE_5M +
				write1h * price.input * CACHE_WRITE_1H;
		}
	}

	let microUSD = 0;
	let hasUnknownModelCost = false;
	let read = 0;
	let allInput = 0;
	const models = Array.from(byModel.values(), ({totals, microUSD: cost}) => {
		if (modelPricing(totals.model) === null) {
			hasUnknownModelCost = true;
		} else {
			totals.costUSD = Math.round(cost) / 1e6;
			microUSD += Math.round(cost);
		}
		read += totals.cacheReadTokens;
		allInput += totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens;
		return totals;
	}).sort((a, b) => (b.costUSD ?? 0) - (a.costUSD ?? 0));

	return {
		models,
		costUSD: microUSD / 1e6,
		hasUnknownModelCost,
		cacheHitRatio: models.length === 0 ? null : allInput === 0 ? 0 : read / allInput,
	};
}

/** `294`, `6.8k`, `6.4M`. */
export function formatUsageTokens(tokens: number): string {
	if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
	if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
	return String(tokens);
}

export function formatCacheHit(ratio: number | null): string {
	return ratio === null ? "—" : `${Math.round(ratio * 100)}%`;
}

export function usageBreakdownRows(model: ModelUsageTotals): Array<[label: string, value: string]> {
	return [
		["Input", formatUsageTokens(model.inputTokens)],
		["Output", formatUsageTokens(model.outputTokens)],
		["Cache read", formatUsageTokens(model.cacheReadTokens)],
		["Cache write", formatUsageTokens(model.cacheWriteTokens)],
	];
}

export interface UsageLimits {
	fiveHour?: RateLimitWindow | null;
	weekly?: RateLimitWindow | null;
}

export function usageLimitRows(limits: UsageLimits | null): Array<{label: string; window: RateLimitWindow}> {
	const rows: Array<{label: string; window: RateLimitWindow}> = [];
	if (limits?.fiveHour) rows.push({label: FIVE_HOUR_LABEL, window: limits.fiveHour});
	if (limits?.weekly) rows.push({label: WEEKLY_LABEL, window: limits.weekly});
	return rows;
}

/** The Usage card as plain text, for "Copy report". */
export function formatUsageReport(breakdown: SessionUsageBreakdown, limits: UsageLimits | null, nowMs: number): string {
	const sections: string[][] = [["Usage"]];
	const limitRows = usageLimitRows(limits);
	if (limitRows.length > 0) {
		sections.push(
			limitRows.map(
				({label, window}) =>
					`${label}: ${Math.round(window.usedPercentage)}% · ${formatResetLabel(window.resetsAt, nowMs)}`,
			),
		);
	}
	sections.push([
		"This session",
		`Cost: ${formatUsd(breakdown.costUSD)}`,
		`Cache hit: ${formatCacheHit(breakdown.cacheHitRatio)}`,
	]);
	for (const model of breakdown.models) {
		sections.push([
			`Breakdown ${model.model}`,
			...usageBreakdownRows(model).map(([label, value]) => `${label}: ${value}`),
		]);
	}
	return sections.map((lines) => lines.join("\n")).join("\n\n");
}
