import {CostStateRecordSchema} from "./runtime-schemas";
import type {SessionCostState} from "./session-cost";

// Server-side: reads a transcript's `cost-state` record. Kept apart from `session-cost.ts` so the client, which only
// parses the API's cost totals, doesn't download the transcript schemas.

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
		.toSorted((a, b) => b.costUSD - a.costUSD);
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
