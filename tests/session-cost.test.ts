import {describe, expect, it} from "vite-plus/test";

import {costStateFromRecord, formatUsd} from "../src/lib/session-cost";

describe("costStateFromRecord", () => {
	it("normalizes a cost-state record, ordering models by cost", () => {
		expect(
			costStateFromRecord({
				type: "cost-state",
				sessionId: "session-alice-100",
				totalCostUSD: 3.5,
				totalAPIDuration: 90_000,
				totalAPIDurationWithoutRetries: 85_000,
				totalToolDuration: 12_000,
				totalLinesAdded: 120,
				totalLinesRemoved: 30,
				totalDuration: 600_000,
				startTime: 1_000,
				hasUnknownModelCost: true,
				modelUsage: {
					"claude-haiku-4-5-20251001": {inputTokens: 10, outputTokens: 5, costUSD: 0.5},
					"claude-opus-5-5[1m]": {
						inputTokens: 1_000,
						outputTokens: 2_000,
						cacheReadInputTokens: 30_000,
						cacheCreationInputTokens: 4_000,
						costUSD: 3,
					},
				},
			}),
		).toStrictEqual({
			totalCostUSD: 3.5,
			linesAdded: 120,
			linesRemoved: 30,
			apiDurationMs: 90_000,
			toolDurationMs: 12_000,
			hasUnknownModelCost: true,
			models: [
				{
					model: "claude-opus-5-5[1m]",
					costUSD: 3,
					inputTokens: 1_000,
					outputTokens: 2_000,
					cacheReadInputTokens: 30_000,
					cacheCreationInputTokens: 4_000,
				},
				{
					model: "claude-haiku-4-5-20251001",
					costUSD: 0.5,
					inputTokens: 10,
					outputTokens: 5,
					cacheReadInputTokens: 0,
					cacheCreationInputTokens: 0,
				},
			],
		});
	});

	it("fills absent totals with zero and leaves out absent durations", () => {
		expect(costStateFromRecord({type: "cost-state"})).toStrictEqual({
			totalCostUSD: 0,
			linesAdded: 0,
			linesRemoved: 0,
			hasUnknownModelCost: false,
			models: [],
		});
	});

	it("rejects records that are not a valid cost-state", () => {
		expect([
			costStateFromRecord({type: "user"}),
			costStateFromRecord({type: "cost-state", totalCostUSD: "1"}),
			costStateFromRecord(null),
		]).toStrictEqual([null, null, null]);
	});
});

describe("formatUsd", () => {
	it("shows cents, and a floor for sub-cent spend", () => {
		expect([formatUsd(0), formatUsd(0.004), formatUsd(0.01), formatUsd(3.456), formatUsd(1234.5)]).toStrictEqual([
			"$0.00",
			"<$0.01",
			"$0.01",
			"$3.46",
			"$1,234.50",
		]);
	});
});
