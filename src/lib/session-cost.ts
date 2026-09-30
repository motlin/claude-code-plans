import {z} from "zod";

import {CostStateRecordSchema} from "./schemas";

const SessionModelCostSchema = z
	.object({
		/** Raw model id, e.g. `claude-opus-5-5[1m]`. */
		model: z.string(),
		costUSD: z.number(),
		inputTokens: z.number(),
		outputTokens: z.number(),
		cacheReadInputTokens: z.number(),
		cacheCreationInputTokens: z.number(),
	})
	.strict();

/** A session's running totals, from its latest `cost-state` transcript record. */
export const SessionCostStateSchema = z
	.object({
		totalCostUSD: z.number(),
		linesAdded: z.number(),
		linesRemoved: z.number(),
		apiDurationMs: z.number().optional(),
		toolDurationMs: z.number().optional(),
		/** Some model had no known price, so `totalCostUSD` undercounts. */
		hasUnknownModelCost: z.boolean(),
		/** Most expensive first. */
		models: z.array(SessionModelCostSchema),
	})
	.strict();

export type SessionCostState = z.infer<typeof SessionCostStateSchema>;

/** The totals a `cost-state` record carries, or null when `record` is not a valid one. */
export function costStateFromRecord(record: unknown): SessionCostState | null {
	const parsed = CostStateRecordSchema.safeParse(record);
	if (!parsed.success) return null;
	const cost = parsed.data;
	const models = Object.entries(cost.modelUsage ?? {})
		.map(([model, usage]) => ({
			model,
			costUSD: usage.costUSD ?? 0,
			inputTokens: usage.inputTokens ?? 0,
			outputTokens: usage.outputTokens ?? 0,
			cacheReadInputTokens: usage.cacheReadInputTokens ?? 0,
			cacheCreationInputTokens: usage.cacheCreationInputTokens ?? 0,
		}))
		.sort((a, b) => b.costUSD - a.costUSD);
	const state: SessionCostState = {
		totalCostUSD: cost.totalCostUSD ?? 0,
		linesAdded: cost.totalLinesAdded ?? 0,
		linesRemoved: cost.totalLinesRemoved ?? 0,
		hasUnknownModelCost: cost.hasUnknownModelCost ?? false,
		models,
	};
	if (cost.totalAPIDuration !== undefined) state.apiDurationMs = cost.totalAPIDuration;
	if (cost.totalToolDuration !== undefined) state.toolDurationMs = cost.totalToolDuration;
	return state;
}

const USD = new Intl.NumberFormat("en-US", {style: "currency", currency: "USD"});

/** `$3.46`; spend that rounds to nothing but is not zero reads `<$0.01`. */
export function formatUsd(amount: number): string {
	if (amount > 0 && amount < 0.005) return "<$0.01";
	return USD.format(amount);
}
