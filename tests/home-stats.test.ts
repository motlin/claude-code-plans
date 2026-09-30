import {mkdirSync, rmSync, utimesSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";

import {openTestDb, type AppDb} from "../src/lib/db/connection";
import {indexJsonlFile} from "../src/lib/db/indexer";
import {getHomeStatsDays} from "../src/lib/db/usage-index";
import * as schema from "../src/lib/db/schema";
import {readStatsCacheTokens} from "../src/lib/stats-cache";
import {
	computeHomeStats,
	formatPeakHour,
	formatTokenCount,
	mergeStatsCacheTokens,
	UsageCollector,
	type HomeStatsDay,
} from "../src/lib/home-stats";

function hours(counts: Record<number, number>): number[] {
	return Array.from({length: 24}, (_, hour) => counts[hour] ?? 0);
}

function day(date: string, overrides: Partial<Omit<HomeStatsDay, "date">> = {}): HomeStatsDay {
	return {
		date,
		sessions: 0,
		messages: 0,
		hourCounts: hours({}),
		tokensByModel: null,
		...overrides,
	};
}

const TODAY = "2026-09-29";

describe("computeHomeStats", () => {
	const days: HomeStatsDay[] = [
		day("2026-08-01", {
			sessions: 2,
			messages: 40,
			hourCounts: hours({9: 2}),
			tokensByModel: {"claude-opus-4-6": 1000},
		}),
		day("2026-09-10", {
			sessions: 1,
			messages: 10,
			hourCounts: hours({14: 1}),
			tokensByModel: {"claude-haiku-4-5-20251001": 3000},
		}),
		day("2026-09-25", {
			sessions: 3,
			messages: 30,
			hourCounts: hours({14: 2, 22: 1}),
			tokensByModel: {"claude-opus-4-6": 500, "claude-haiku-4-5-20251001": 100},
		}),
		day("2026-09-26"),
	];

	it("totals every day for All and counts only days with activity as active", () => {
		expect(computeHomeStats(days, "all", TODAY)).toStrictEqual({
			sessions: 6,
			messages: 80,
			totalTokens: 4600,
			activeDays: 3,
			peakHour: 14,
			favoriteModel: "claude-haiku-4-5-20251001",
			models: [
				{model: "claude-haiku-4-5-20251001", tokens: 3100, share: 3100 / 4600},
				{model: "claude-opus-4-6", tokens: 1500, share: 1500 / 4600},
			],
			heatmap: expect.any(Array),
		});
	});

	it("limits 7d and 30d to the trailing window ending today", () => {
		const week = computeHomeStats(days, "7d", TODAY);
		expect({
			sessions: week.sessions,
			messages: week.messages,
			totalTokens: week.totalTokens,
			activeDays: week.activeDays,
			peakHour: week.peakHour,
			favoriteModel: week.favoriteModel,
		}).toStrictEqual({
			sessions: 3,
			messages: 30,
			totalTokens: 600,
			activeDays: 1,
			peakHour: 14,
			favoriteModel: "claude-opus-4-6",
		});
		expect(week.heatmap.map((cell) => cell.date)).toStrictEqual([
			"2026-09-23",
			"2026-09-24",
			"2026-09-25",
			"2026-09-26",
			"2026-09-27",
			"2026-09-28",
			"2026-09-29",
		]);
		expect(week.heatmap.find((cell) => cell.date === "2026-09-25")).toStrictEqual({
			date: "2026-09-25",
			value: 30,
		});

		const month = computeHomeStats(days, "30d", TODAY);
		expect([month.sessions, month.activeDays, month.heatmap.length]).toStrictEqual([4, 2, 30]);
	});

	it("breaks a peak-hour tie toward the earlier hour", () => {
		const tied = [day("2026-09-28", {sessions: 2, messages: 2, hourCounts: hours({20: 1, 7: 1})})];
		expect(computeHomeStats(tied, "all", TODAY).peakHour).toBe(7);
	});

	it("breaks a favorite-model tie toward the alphabetically first id", () => {
		const tied = [
			day("2026-09-28", {
				sessions: 1,
				messages: 1,
				tokensByModel: {"claude-sonnet-4-5": 200, "claude-opus-4-6": 200},
			}),
		];
		const stats = computeHomeStats(tied, "all", TODAY);
		expect(stats.favoriteModel).toBe("claude-opus-4-6");
		expect(stats.models.map((row) => row.model)).toStrictEqual(["claude-opus-4-6", "claude-sonnet-4-5"]);
	});

	it("reports unknown tokens, peak hour and model as null instead of guessing", () => {
		const stats = computeHomeStats([day("2026-09-28", {messages: 3})], "all", TODAY);
		expect({
			sessions: stats.sessions,
			messages: stats.messages,
			totalTokens: stats.totalTokens,
			activeDays: stats.activeDays,
			peakHour: stats.peakHour,
			favoriteModel: stats.favoriteModel,
			models: stats.models,
		}).toStrictEqual({
			sessions: 0,
			messages: 3,
			totalTokens: null,
			activeDays: 1,
			peakHour: null,
			favoriteModel: null,
			models: [],
		});
	});

	it("returns an empty heatmap window and zero totals when there is no data", () => {
		const stats = computeHomeStats([], "all", TODAY);
		expect({...stats, heatmap: stats.heatmap.length}).toStrictEqual({
			sessions: 0,
			messages: 0,
			totalTokens: null,
			activeDays: 0,
			peakHour: null,
			favoriteModel: null,
			models: [],
			heatmap: 1,
		});
	});

	it("spans All from the first active day to today, capped at 52 weeks", () => {
		const stats = computeHomeStats([day("2026-09-20", {messages: 1})], "all", TODAY);
		expect(stats.heatmap.map((cell) => cell.date)[0]).toBe("2026-09-20");
		expect(stats.heatmap).toHaveLength(10);

		const old = computeHomeStats([day("2020-01-01", {messages: 1})], "all", TODAY);
		expect(old.heatmap).toHaveLength(364);
		expect(old.activeDays).toBe(1);
	});
});

describe("formatters", () => {
	it("formats the peak hour on a 12-hour clock", () => {
		expect([0, 9, 12, 23].map(formatPeakHour)).toStrictEqual(["12 AM", "9 AM", "12 PM", "11 PM"]);
	});

	it("formats token counts compactly", () => {
		expect([950, 4600, 1_250_000, 3_400_000_000].map(formatTokenCount)).toStrictEqual([
			"950",
			"4.6K",
			"1.3M",
			"3.4B",
		]);
	});
});

function localIso(year: number, month: number, dayOfMonth: number, hour: number): string {
	return new Date(year, month - 1, dayOfMonth, hour).toISOString();
}

function assistant(
	id: string,
	timestamp: string,
	model: string,
	usage: Record<string, number>,
	content: unknown[] = [{type: "text", text: "hi"}],
) {
	return {
		type: "assistant",
		timestamp,
		message: {id, model, role: "assistant", usage, content},
	};
}

describe("UsageCollector", () => {
	it("counts one usage per message id, by local day and model, skipping synthetic turns", () => {
		const collector = new UsageCollector();
		const usage = {
			input_tokens: 10,
			output_tokens: 5,
			cache_read_input_tokens: 100,
			cache_creation_input_tokens: 20,
		};
		collector.add({
			type: "user",
			timestamp: localIso(2026, 9, 28, 9),
			message: {role: "user", content: "go"},
		});
		collector.add(assistant("msg_1", localIso(2026, 9, 28, 9), "claude-opus-4-6", usage));
		collector.add(
			assistant("msg_1", localIso(2026, 9, 28, 9), "claude-opus-4-6", usage, [
				{type: "tool_use", id: "t", name: "Bash", input: {}},
			]),
		);
		collector.add(
			assistant("msg_2", localIso(2026, 9, 29, 1), "claude-opus-4-6", {
				input_tokens: 1,
				output_tokens: 2,
			}),
		);
		collector.add(assistant("msg_3", localIso(2026, 9, 29, 2), "<synthetic>", usage));
		collector.add({
			type: "user",
			timestamp: localIso(2026, 9, 29, 2),
			message: {role: "user", content: [{type: "tool_result", tool_use_id: "t"}]},
		});

		expect(collector.rows()).toStrictEqual([
			{
				day: "2026-09-28",
				model: null,
				messages: 1,
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheCreationTokens: 0,
			},
			{
				day: "2026-09-28",
				model: "claude-opus-4-6",
				messages: 2,
				inputTokens: 10,
				outputTokens: 5,
				cacheReadTokens: 100,
				cacheCreationTokens: 20,
			},
			{
				day: "2026-09-29",
				model: null,
				messages: 1,
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheCreationTokens: 0,
			},
			{
				day: "2026-09-29",
				model: "claude-opus-4-6",
				messages: 1,
				inputTokens: 1,
				outputTokens: 2,
				cacheReadTokens: 0,
				cacheCreationTokens: 0,
			},
		]);
	});
});

describe("mergeStatsCacheTokens", () => {
	const indexDays = [
		day("2026-09-27", {messages: 4, tokensByModel: {"claude-opus-4-6": 10}}),
		day("2026-09-28", {messages: 2, tokensByModel: {"claude-opus-4-6": 20}}),
		day("2026-09-29", {messages: 1, tokensByModel: {"claude-opus-4-6": 30}}),
	];

	it("prefers the CLI stats cache tokens for the days it lists when it is fresh", () => {
		expect(
			mergeStatsCacheTokens(
				indexDays,
				{
					lastComputedDate: "2026-09-28",
					dailyModelTokens: [
						{date: "2026-09-26", tokensByModel: {"claude-sonnet-4-5": 7}},
						{date: "2026-09-28", tokensByModel: {"claude-sonnet-4-5": 99}},
					],
				},
				TODAY,
			),
		).toStrictEqual([
			day("2026-09-26", {tokensByModel: {"claude-sonnet-4-5": 7}}),
			day("2026-09-27", {messages: 4, tokensByModel: {"claude-opus-4-6": 10}}),
			day("2026-09-28", {messages: 2, tokensByModel: {"claude-sonnet-4-5": 99}}),
			day("2026-09-29", {messages: 1, tokensByModel: {"claude-opus-4-6": 30}}),
		]);
	});

	it("ignores a stale or missing stats cache", () => {
		const stale = {lastComputedDate: "2026-05-11", dailyModelTokens: []};
		expect(mergeStatsCacheTokens(indexDays, stale, TODAY)).toStrictEqual(indexDays);
		expect(mergeStatsCacheTokens(indexDays, null, TODAY)).toStrictEqual(indexDays);
	});
});

describe("usage_daily index", () => {
	const testDir = join(tmpdir(), `claude-home-stats-test-${process.pid}`);
	const projectId = "-Users-alice-projects-app";
	let db: AppDb;

	beforeEach(() => {
		mkdirSync(join(testDir, projectId), {recursive: true});
		db = openTestDb();
	});

	afterEach(() => {
		db.close();
		rmSync(testDir, {recursive: true, force: true});
	});

	it("aggregates per-day messages and tokens and reindexes idempotently", async () => {
		const filePath = join(testDir, projectId, "session-usage-a.jsonl");
		const lines = [
			{
				type: "user",
				timestamp: localIso(2026, 9, 28, 9),
				message: {role: "user", content: "hello"},
			},
			assistant("msg_1", localIso(2026, 9, 28, 9), "claude-opus-4-6", {
				input_tokens: 10,
				output_tokens: 5,
				cache_read_input_tokens: 1000,
			}),
			assistant("msg_2", localIso(2026, 9, 29, 10), "claude-haiku-4-5-20251001", {
				input_tokens: 3,
				output_tokens: 4,
			}),
		];
		writeFileSync(filePath, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");

		await indexJsonlFile(db.index, filePath, projectId);
		utimesSync(filePath, new Date(2026, 8, 29, 12), new Date(2026, 8, 29, 12));
		await indexJsonlFile(db.index, filePath, projectId);

		const days = getHomeStatsDays(db.index);
		expect(days.map(({hourCounts: _hours, ...rest}) => rest)).toStrictEqual(
			expect.arrayContaining([
				{
					date: "2026-09-28",
					sessions: expect.any(Number),
					messages: 2,
					tokensByModel: {"claude-opus-4-6": 15},
				},
				{
					date: "2026-09-29",
					sessions: expect.any(Number),
					messages: 1,
					tokensByModel: {"claude-haiku-4-5-20251001": 7},
				},
			]),
		);
		expect(days.reduce((sum, row) => sum + row.sessions, 0)).toBe(1);
		expect(db.index.select().from(schema.usageDaily).all()).toHaveLength(3);
	});
});

describe("readStatsCacheTokens", () => {
	const dir = join(tmpdir(), `claude-stats-cache-test-${process.pid}`);

	beforeEach(() => mkdirSync(dir, {recursive: true}));
	afterEach(() => rmSync(dir, {recursive: true, force: true}));

	const cache = {
		version: 3,
		lastComputedDate: "2026-09-28",
		dailyActivity: [{date: "2026-09-28", messageCount: 3, sessionCount: 1, toolCallCount: 2}],
		dailyModelTokens: [{date: "2026-09-28", tokensByModel: {"claude-opus-4-6": 42}}],
		modelUsage: {"claude-opus-4-6": {inputTokens: 2, outputTokens: 40}},
		totalSessions: 1,
		totalMessages: 3,
		hourCounts: {"9": 1},
	};

	it("reads the per-day token totals", async () => {
		writeFileSync(join(dir, "stats-cache.json"), JSON.stringify(cache));
		expect(await readStatsCacheTokens(dir)).toStrictEqual({
			lastComputedDate: "2026-09-28",
			dailyModelTokens: [{date: "2026-09-28", tokensByModel: {"claude-opus-4-6": 42}}],
		});
	});

	it("returns null for a missing or unrecognized file", async () => {
		expect(await readStatsCacheTokens(dir)).toBeNull();
		writeFileSync(join(dir, "stats-cache.json"), JSON.stringify({...cache, surprise: true}));
		expect(await readStatsCacheTokens(dir)).toBeNull();
	});
});
