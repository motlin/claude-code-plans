import {describe, expect, it} from "vite-plus/test";

import {
	aggregateSessionUsage,
	formatUsageReport,
	formatUsageTokens,
	modelPricing,
} from "../src/lib/session-usage-breakdown";
import {assistantUsage as assistant, USAGE_RECORDS} from "./fixtures/usage-records";

describe("aggregateSessionUsage", () => {
	it("totals each model once per message, with the cache-hit ratio and priced cost", () => {
		expect(aggregateSessionUsage(USAGE_RECORDS)).toStrictEqual({
			models: [
				{
					model: "Opus 5.5",
					inputTokens: 150,
					outputTokens: 500,
					cacheReadTokens: 30_000,
					cacheWriteTokens: 2_000,
					costUSD: 0.0266,
				},
				{
					model: "Haiku 4.5",
					inputTokens: 1_000,
					outputTokens: 500,
					cacheReadTokens: 0,
					cacheWriteTokens: 4_000,
					costUSD: 0.0115,
				},
			],
			costUSD: 0.0381,
			hasUnknownModelCost: false,
			cacheHitRatio: 30_000 / 37_150,
		});
	});

	it("reports no ratio for a session without assistant usage", () => {
		expect(aggregateSessionUsage([{type: "user", message: {role: "user", content: "hi"}}])).toStrictEqual({
			models: [],
			costUSD: 0,
			hasUnknownModelCost: false,
			cacheHitRatio: null,
		});
	});

	it("flags a model without a known price and leaves it out of the cost", () => {
		expect(
			aggregateSessionUsage([assistant("msg_1", "claude-mystery-9", {input_tokens: 10, output_tokens: 5})]),
		).toStrictEqual({
			models: [
				{
					model: "Mystery 9",
					inputTokens: 10,
					outputTokens: 5,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					costUSD: null,
				},
			],
			costUSD: 0,
			hasUnknownModelCost: true,
			cacheHitRatio: 0,
		});
	});
});

describe("modelPricing", () => {
	it("prices by display name, whatever the id's date or window suffix", () => {
		expect([
			modelPricing("Fable 5.1"),
			modelPricing("Opus 5.5"),
			modelPricing("Sonnet 4.6"),
			modelPricing("Unknown 1"),
		]).toStrictEqual([
			{input: 10, output: 50, cacheRead: 0.25},
			{input: 4, output: 20, cacheRead: 0.2},
			{input: 3, output: 15, cacheRead: 0.3},
			null,
		]);
	});
});

describe("formatUsageTokens", () => {
	it("abbreviates thousands and millions like upstream", () => {
		expect([294, 6_800, 6_400_000, 1_000].map(formatUsageTokens)).toStrictEqual(["294", "6.8k", "6.4M", "1.0k"]);
	});
});

describe("formatUsageReport", () => {
	it("renders the card as plain text", () => {
		expect(formatUsageReport(aggregateSessionUsage(USAGE_RECORDS), null, 0)).toBe(
			[
				"Usage",
				"",
				"This session",
				"Cost: $0.04",
				"Cache hit: 81%",
				"",
				"Breakdown Opus 5.5",
				"Input: 150",
				"Output: 500",
				"Cache read: 30.0k",
				"Cache write: 2.0k",
				"",
				"Breakdown Haiku 4.5",
				"Input: 1.0k",
				"Output: 500",
				"Cache read: 0",
				"Cache write: 4.0k",
			].join("\n"),
		);
	});

	it("lists plan limits before the session", () => {
		const now = Date.parse("2026-10-01T12:00:00Z");
		const report = formatUsageReport(
			{models: [], costUSD: 0, hasUnknownModelCost: false, cacheHitRatio: null},
			{fiveHour: {usedPercentage: 29, resetsAt: (now + 2 * 3_600_000) / 1000}},
			now,
		);
		expect(report.split("\n").slice(0, 4)).toStrictEqual(["Usage", "", "5-hour limit: 29% · Resets in 2 hr", ""]);
	});
});
