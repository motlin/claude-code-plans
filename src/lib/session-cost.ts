import {z} from "zod";

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

const USD = new Intl.NumberFormat("en-US", {style: "currency", currency: "USD"});

/** `$3.46`; spend that rounds to nothing but is not zero reads `<$0.01`. */
export function formatUsd(amount: number): string {
	if (amount > 0 && amount < 0.005) return "<$0.01";
	return USD.format(amount);
}
