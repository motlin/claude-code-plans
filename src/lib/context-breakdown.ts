import {ContextUsageTwinSchema, type ContextUsageTwin} from "./schemas";

export type ContextCategoryKind = ContextUsageTwin["categories"][number]["kind"];

/** Upstream's `getContextUsage` breakdown, as the session rail's Context card renders it. */
export interface ContextBreakdown {
	categories: {name: string; tokens: number; kind: ContextCategoryKind}[];
	totalTokens: number;
	rawMaxTokens: number;
	percentage: number;
	mcpTools: {name: string; serverName: string; tokens: number}[];
	memoryFiles: {path: string; type: string; tokens: number}[];
	agents: {agentType: string; source: string; tokens: number}[];
	fetchedAt: string;
	/** `context-command`: the twin a `/context` run persists. `mod`: a CLI mod's per-turn mirror. */
	source: "context-command" | "mod";
}

export function breakdownFromTwin(twin: ContextUsageTwin, fetchedAt: string): ContextBreakdown {
	return {
		categories: twin.categories.map(({name, tokens, kind}) => ({name, tokens, kind})),
		totalTokens: twin.total_tokens,
		rawMaxTokens: twin.raw_max_tokens,
		percentage: twin.percentage,
		mcpTools: twin.mcp_tools.map((tool) => ({name: tool.name, serverName: tool.server_name, tokens: tool.tokens})),
		memoryFiles: twin.memory_files.map(({path, type, tokens}) => ({path, type, tokens})),
		agents: twin.agents.map((agent) => ({agentType: agent.agent_type, source: agent.source, tokens: agent.tokens})),
		fetchedAt,
		source: "context-command",
	};
}

type RecordLike = Record<string, unknown>;

function isRecord(value: unknown): value is RecordLike {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A compaction or `/clear` resets the context, so any earlier breakdown is stale (upstream's `contextResets`). */
function isContextReset(record: RecordLike): boolean {
	if (record["type"] !== "system") return false;
	if (record["subtype"] === "compact_boundary") return true;
	const commandRun = record["commandRun"];
	return isRecord(commandRun) && commandRun["command"] === "clear";
}

/** The newest `/context` twin's breakdown, or null when none exists or a later reset made it stale. */
export function latestBreakdown(records: readonly unknown[]): ContextBreakdown | null {
	for (let i = records.length - 1; i >= 0; i--) {
		const record = records[i];
		if (!isRecord(record)) continue;
		if (isContextReset(record)) return null;
		if (record["type"] !== "system" || record["contextUsage"] === undefined) continue;
		const parsed = ContextUsageTwinSchema.safeParse(record["contextUsage"]);
		if (!parsed.success) continue;
		const timestamp = record["timestamp"];
		return breakdownFromTwin(parsed.data, typeof timestamp === "string" ? timestamp : "");
	}
	return null;
}

type BreakdownCategory = ContextBreakdown["categories"][number];

export interface ContextLegendRow {
	name: string;
	tokens: number;
	kind?: ContextCategoryKind;
	id: string;
	/** The meter series this row is drawn in, or null for rows the meter leaves out (free, deferred). */
	meterSeries: string | null;
	/** An inline swatch color for rows without a meter series, else null. */
	color: string | null;
}

export interface ContextMeterCategory {
	id: string;
	label: string;
	color?: "reference" | "muted";
}

export interface ContextLegend {
	legend: ContextLegendRow[];
	meterCategories: ContextMeterCategory[];
	meterValues: Record<string, number>;
	barTotal: number;
	usedTokens: number;
	usedPct: number;
}

/** Upstream's `M`: the most meter series before the used tail folds into "Other". */
const MAX_METER_SERIES = 6;

const isFree = (category: BreakdownCategory) => category.kind === "free";
const isBuffer = (category: BreakdownCategory) => category.kind === "buffer";
const isDeferred = (category: BreakdownCategory) => category.kind === "deferred";
const byTokensDescending = (a: BreakdownCategory, b: BreakdownCategory) => b.tokens - a.tokens;

/** Upstream's `O`: the inline swatch for rows the meter leaves out. */
function swatchColor(category: BreakdownCategory): string {
	return isFree(category) ? "var(--chart-reference-tint)" : "var(--chart-muted)";
}

/** Upstream's `k`: the sum of the used rows, or the reported total when the breakdown has no Free space row. */
function usedSum(b: ContextBreakdown): number {
	if (!b.categories.some(isFree)) return b.totalTokens;
	return b.categories.reduce(
		(sum, category) =>
			isFree(category) || isBuffer(category) || isDeferred(category) ? sum : sum + category.tokens,
		0,
	);
}

/** Upstream's legend builder `N`: legend rows, stacked-meter series and the headline totals for a breakdown. */
export function buildContextLegend(b: ContextBreakdown, liveTokens: number | null): ContextLegend {
	const categories = b.categories;
	const used = categories.filter((c) => !isFree(c) && !isBuffer(c) && !isDeferred(c)).toSorted(byTokensDescending);
	const deferred = categories.filter(isDeferred).toSorted(byTokensDescending);
	const sum = usedSum(b);
	const since = liveTokens === null ? 0 : Math.max(0, liveTokens - sum);
	const freeRow = categories.find(isFree);
	const free = freeRow && {...freeRow, tokens: Math.max(0, freeRow.tokens - since)};
	const sinceOverflow = Math.max(0, since - (freeRow?.tokens ?? 0));
	const bufferRow = categories.find(isBuffer);
	const buffer = bufferRow && {...bufferRow, tokens: Math.max(0, bufferRow.tokens - sinceOverflow)};
	const usedTokens = sum + since;
	const usedPct = b.rawMaxTokens > 0 ? (usedTokens / b.rawMaxTokens) * 100 : b.percentage;
	const extras = (buffer ? 1 : 0) + (since > 0 ? 1 : 0);
	const folded = used.length + extras > MAX_METER_SERIES;
	const shown = folded ? 5 - extras : used.length;
	const series = used.slice(0, shown);
	const tail = used.slice(shown);
	const sinceRow = since > 0 ? {name: "Since last update", tokens: since} : null;

	return {
		legend: [
			...used.map((c, i) => ({
				...c,
				id: `used-${i}`,
				meterSeries: i < shown ? `used-${i}` : "other",
				color: null,
			})),
			...(sinceRow ? [{...sinceRow, id: "since", meterSeries: "since", color: null}] : []),
			...(buffer ? [{...buffer, id: "buffer", meterSeries: "buffer", color: null}] : []),
			...(free ? [{...free, id: "free", meterSeries: null, color: swatchColor(free)}] : []),
			...deferred.map((c, i) => ({...c, id: `deferred-${i}`, meterSeries: null, color: swatchColor(c)})),
		],
		meterCategories: [
			...series.map((c, i) => ({id: `used-${i}`, label: c.name})),
			...(folded ? [{id: "other", label: "Other", color: "reference" as const}] : []),
			...(sinceRow ? [{id: "since", label: sinceRow.name, color: "reference" as const}] : []),
			...(buffer ? [{id: "buffer", label: buffer.name, color: "muted" as const}] : []),
		],
		meterValues: Object.fromEntries([
			...series.map((c, i) => [`used-${i}`, c.tokens] as const),
			...(folded ? [["other", tail.reduce((total, c) => total + c.tokens, 0)] as const] : []),
			...(sinceRow ? [["since", sinceRow.tokens] as const] : []),
			...(buffer ? [["buffer", buffer.tokens] as const] : []),
		]),
		barTotal:
			Math.max(
				b.rawMaxTokens,
				[...used, ...(sinceRow ? [sinceRow] : []), ...(buffer ? [buffer] : []), ...(free ? [free] : [])].reduce(
					(total, c) => total + c.tokens,
					0,
				),
			) || 1,
		usedTokens,
		usedPct,
	};
}
