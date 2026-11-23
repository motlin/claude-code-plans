import {z} from "zod";

/**
 * The `/usage` card's session numbers (upstream's `epitaxyUsageStats` output, ca288e1f2 `g`), plus the local
 * `cost-state` record's unknown-model flag. Client-safe: the accumulator that builds it reads transcripts and lives
 * in `session-usage-accumulator.ts`.
 */

const ModelTokensSchema = z.strictObject(
	{
		input: z.number(),
		output: z.number(),
		cacheRead: z.number(),
		cacheWrite: z.number(),
	},
);
export type ModelTokens = z.infer<typeof ModelTokensSchema>;

const AttributionRowSchema = z.strictObject(
	{
		name: z.string(),
		pct: z.number(),
	},
);
export type AttributionRow = z.infer<typeof AttributionRowSchema>;

const SessionUsageResultSchema = z.strictObject(
	{
		costUSD: z.number(),
		apiMs: z.number(),
		wallMs: z.number(),
		perModel: z.record(
			z.string(),
			z.strictObject(
				{
					costUSD: z.number(),
					webSearch: z.number(),
				},
			),
		),
	},
);
export type SessionUsageResult = z.infer<typeof SessionUsageResultSchema>;

export const SessionUsageStatsSchema = z.strictObject(
	{
		/** Tokens per model from the session's own (not subagent) assistant records, deduped per message id. */
		usage: z.record(z.string(), ModelTokensSchema),
		/** The newest `cost-state` record's totals, standing in for upstream's SDK `result`; null before one. */
		result: SessionUsageResultSchema.nullable(),
		attribution: z.strictObject(
			{
				subagents: z.array(AttributionRowSchema),
				skills: z.array(AttributionRowSchema),
				mcpServers: z.array(AttributionRowSchema),
			},
		),
		lineChanges: z.strictObject(
			{
				added: z.number(),
				removed: z.number(),
			},
		),
		/** Some model had no known price, so the cost undercounts. */
		hasUnknownModelCost: z.boolean(),
	},
);
export type SessionUsageStats = z.infer<typeof SessionUsageStatsSchema>;

/** Upstream's empty stats (`x`). */
export const EMPTY_SESSION_USAGE_STATS: SessionUsageStats =
{
	usage: {},
	result: null,
	attribution:
	{
		subagents: [],
		skills: [],
		mcpServers: [],
	},
	lineChanges:
	{
		added: 0,
		removed: 0,
	},
	hasUnknownModelCost: false,
};

const TOKEN_UNITS: ReadonlyArray<readonly [number, string]> = [
	[1e9, "B"],
	[1e6, "M"],
	[1e3, "K"],
];

/** One decimal with ".0" stripped. */
function oneDecimal(value: number): string
{
	return value.toFixed(1).replace(/\.0$/, "");
}

/**
 * Upstream's `ic` token count: "999", "12.3K", "3.5M", "1.2B", one decimal with ".0" stripped. A value that rounds
 * up to 1000 of a unit rolls over to the next one (999999 → "1M").
 */
export function formatTokensShort(count: number): string
{
	for (let index = 0; index < TOKEN_UNITS.length; index++)
	{
		const [size, suffix] = TOKEN_UNITS[index] ?? [1, ""];
		if (count < size) continue;
		const scaled = oneDecimal(count / size);
		const bigger = TOKEN_UNITS[index - 1];
		if (Number(scaled) >= 1000 && bigger !== undefined) return `${oneDecimal(count / bigger[0])}${bigger[1]}`;
		return `${scaled}${suffix}`;
	}
	return String(count);
}

/**
 * Upstream's `TV`: whole seconds (at least 1) as narrow units, hours with minutes, minutes with seconds, or seconds
 * alone: "1h 5m", "3m 12s", "8s".
 */
export function formatNarrowDuration(ms: number): string
{
	const total = Math.max(1, Math.round(ms / 1000));
	const seconds = total % 60;
	const minutes = Math.floor(total / 60) % 60;
	const hours = Math.floor(total / 3600);
	if (hours > 0) return `${hours}h ${minutes}m`;
	if (minutes > 0) return `${minutes}m ${seconds}s`;
	return `${seconds}s`;
}

/** A plan window as the copy report lists it (upstream's `EV`). */
export interface UsageReportWindow
{
	key: string;
	utilization: number | null;
	resetsAt: string | null;
	expires: boolean;
}

export interface UsageReportInput
{
	generatedAt: string;
	userAgent: string;
	windows: readonly UsageReportWindow[];
	planError: boolean;
	sessionUsage: Readonly<Record<string, ModelTokens>>;
	resultStats: Pick<SessionUsageResult, "costUSD" | "apiMs" | "wallMs"> | null;
	/** Upstream's model display name (`Wp`). */
	modelName: (model: string) => string;
}

function wholeMinutes(ms: number): string
{
	return `${Math.round(ms / 60_000)}m`;
}

/** Upstream's `xB` "Copy report" text, without the desktop-only "Local activity" line. */
export function usageReport(input: UsageReportInput): string
{
	const lines = [`Claude Code usage report (${input.generatedAt})`, `Client: ${input.userAgent}`, "", "Plan limits:"];
	const windows = input.windows.filter((window) => window.utilization !== null);
	if (input.planError) lines.push("- unavailable (limits fetch failed)");
	else if (windows.length === 0) lines.push("- none reported");
	else
		for (const window of windows)
		{
			const pct = Math.round(Math.max(0, Math.min(100, window.utilization ?? 0)));
			const reset =
				window.resetsAt === null ? "" : ` (${window.expires ? "expires" : "resets"} ${window.resetsAt})`;
			lines.push(`- ${window.key}: ${pct}%${reset}`);
		}
	const models = Object.entries(input.sessionUsage);
	if (models.length > 0 || input.resultStats !== null)
	{
		lines.push("", "Session:");
		for (const [model, tokens] of models)
			lines.push(
				`- ${input.modelName(model)}: ${formatTokensShort(tokens.input)} in / ${formatTokensShort(tokens.output)} out / ${formatTokensShort(tokens.cacheRead)} cache read / ${formatTokensShort(tokens.cacheWrite)} cache write`,
			);
		if (input.resultStats !== null)
			lines.push(
				`- Cost: $${input.resultStats.costUSD.toFixed(2)} | API ${wholeMinutes(input.resultStats.apiMs)} | Wall ${wholeMinutes(input.resultStats.wallMs)}`,
			);
	}
	return lines.join("\n");
}
