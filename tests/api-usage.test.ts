import {mkdtemp, rm, utimes, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import {
	formatSessionReset,
	formatWeeklyReset,
	paceHeadline,
	UsageSummaryResponse,
	type UsageSummary,
} from "../src/lib/usage";
import {handleUsageRequest} from "../src/routes/api/usage";

const RATE_LIMITS = {
	five_hour: {used_percentage: 16, resets_at: 1_790_000_000},
	seven_day: {used_percentage: 66, resets_at: 1_790_300_000},
};

let directory: string;

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "api-usage-"));
});

afterEach(async () => {
	await rm(directory, {recursive: true, force: true});
});

async function writeStatusline(name: string, json: unknown, mtimeSeconds: number): Promise<void> {
	const filePath = join(directory, name);
	await writeFile(filePath, typeof json === "string" ? json : JSON.stringify(json));
	await utimes(filePath, mtimeSeconds, mtimeSeconds);
}

async function requestUsage(statuslineDirectory: string): Promise<unknown> {
	const response = await handleUsageRequest(statuslineDirectory);
	expect(response.status).toBe(200);
	expect(response.headers.get("Cache-Control")).toBe("private, max-age=0, must-revalidate");
	return response.json();
}

describe("GET /api/usage", () => {
	it("returns the rate limits of the most recently modified statusline", async () => {
		await writeStatusline(
			"old-session.json",
			{
				rate_limits: {
					five_hour: {used_percentage: 90, resets_at: 1},
					seven_day: {used_percentage: 95, resets_at: 2},
				},
			},
			1_700_000_000,
		);
		await writeStatusline("new-session.json", {rate_limits: RATE_LIMITS}, 1_700_000_100);

		expect(await requestUsage(directory)).toStrictEqual({
			fiveHour: {usedPct: 16, resetsAt: 1_790_000_000},
			sevenDay: {usedPct: 66, resetsAt: 1_790_300_000},
			updatedAt: new Date(1_700_000_100_000).toISOString(),
		});
	});

	it("returns null windows when the newest statusline has no rate_limits", async () => {
		await writeStatusline("old-session.json", {rate_limits: RATE_LIMITS}, 1_700_000_000);
		await writeStatusline("new-session.json", {model: {id: "m"}}, 1_700_000_100);

		expect(await requestUsage(directory)).toStrictEqual({
			fiveHour: null,
			sevenDay: null,
			updatedAt: new Date(1_700_000_100_000).toISOString(),
		});
	});

	it("returns null for a missing window", async () => {
		await writeStatusline("session.json", {rate_limits: {five_hour: RATE_LIMITS.five_hour}}, 1_700_000_000);

		expect(await requestUsage(directory)).toStrictEqual({
			fiveHour: {usedPct: 16, resetsAt: 1_790_000_000},
			sevenDay: null,
			updatedAt: new Date(1_700_000_000_000).toISOString(),
		});
	});

	it("skips unreadable statuslines and non-json files", async () => {
		await writeStatusline("valid.json", {rate_limits: RATE_LIMITS}, 1_700_000_000);
		await writeStatusline("broken.json", "{not json", 1_700_000_100);
		await writeStatusline("notes.txt", "{}", 1_700_000_200);

		expect(await requestUsage(directory)).toStrictEqual({
			fiveHour: {usedPct: 16, resetsAt: 1_790_000_000},
			sevenDay: {usedPct: 66, resetsAt: 1_790_300_000},
			updatedAt: new Date(1_700_000_000_000).toISOString(),
		});
	});

	it("returns all nulls when there is no statusline data", async () => {
		const empty = {fiveHour: null, sevenDay: null, updatedAt: null};
		expect(await requestUsage(directory)).toStrictEqual(empty);
		expect(await requestUsage(join(directory, "missing"))).toStrictEqual(empty);
	});

	it("validates with the strict client response schema", async () => {
		await writeStatusline("session.json", {rate_limits: RATE_LIMITS}, 1_700_000_000);
		expect(() => UsageSummaryResponse.parse({fiveHour: null, sevenDay: null})).toThrow(
			"Invalid input: expected string, received undefined",
		);
		expect(UsageSummaryResponse.parse(await requestUsage(directory))).toStrictEqual({
			fiveHour: {usedPct: 16, resetsAt: 1_790_000_000},
			sevenDay: {usedPct: 66, resetsAt: 1_790_300_000},
			updatedAt: new Date(1_700_000_000_000).toISOString(),
		});
	});
});

// Upstream's pace headline, in New York time against a Tue Oct 27 2026 4:00 AM EDT weekly reset.
const ZONE = "America/New_York";
/** Epoch ms for an October 2026 wall-clock time in EDT (UTC−4). */
function edt(day: number, hour: number, minute = 0): number {
	return Date.UTC(2026, 9, day, hour + 4, minute);
}
const WEEK_RESET_MS = edt(27, 4);

function weekly(usedPct: number, fiveHour: UsageSummary["fiveHour"] = null): UsageSummary {
	return {fiveHour, sevenDay: {usedPct, resetsAt: WEEK_RESET_MS / 1000}, updatedAt: null};
}

describe("paceHeadline", () => {
	it.each([
		{
			name: "zero",
			usage: weekly(0),
			nowMs: edt(22, 4),
			expected: "No usage yet. 100% of your weekly limit is available.",
		},
		{name: "fresh", usage: weekly(5), nowMs: edt(22, 4), expected: "Fresh week. 5% of your weekly limit used."},
		{
			name: "early, four hours after the reset",
			usage: weekly(10),
			nowMs: edt(20, 8),
			expected: "10% of your weekly limit used.",
		},
		{
			name: "on track, reset in four days",
			usage: weekly(20),
			nowMs: edt(23, 4),
			expected: "On track. You should reach Tuesday’s reset with room to spare.",
		},
		{
			name: "heads up, reset six or more days away",
			usage: weekly(15),
			nowMs: edt(20, 17),
			expected: "Heads up. At this pace you’ll run out Friday evening, before the Oct 27 reset.",
		},
		{
			name: "heads up, reset on a weekday",
			usage: weekly(37),
			nowMs: edt(21, 12),
			expected: "Heads up. At this pace you’ll run out Friday evening, before Tuesday’s reset.",
		},
		{
			name: "heads up, run-out tomorrow",
			usage: weekly(90),
			nowMs: edt(25, 20),
			expected: "Heads up. At this pace you’ll run out tomorrow morning, before Tuesday’s reset.",
		},
		{
			name: "heads up, run-out on the reset's own day",
			usage: weekly(98),
			nowMs: edt(27, 0, 30),
			expected: "Heads up. At this pace you’ll run out tonight, before the 4:00 AM reset.",
		},
		{
			name: "limit hit",
			usage: weekly(100),
			nowMs: edt(23, 4),
			expected: "Limit hit. You can send new messages when your week resets Tuesday 4:00 AM EDT.",
		},
		{
			name: "limit hit, reset six or more days away",
			usage: weekly(100),
			nowMs: edt(20, 12),
			expected: "Limit hit. You can send new messages when your week resets Oct 27, 4:00 AM EDT.",
		},
		{name: "limit hit, reset already past", usage: weekly(100), nowMs: edt(27, 5), expected: "Limit hit."},
		{
			name: "session window ahead of pace, weekly on track",
			usage: weekly(20, {usedPct: 90, resetsAt: edt(23, 6) / 1000}),
			nowMs: edt(23, 4),
			expected: "On track. You should reach Tuesday’s reset with room to spare.",
		},
		{
			name: "session window only",
			usage: {fiveHour: {usedPct: 10, resetsAt: edt(23, 6) / 1000}, sevenDay: null, updatedAt: null},
			nowMs: edt(23, 4),
			expected: null,
		},
		{
			name: "no rate limits",
			usage: {fiveHour: null, sevenDay: null, updatedAt: null},
			nowMs: edt(23, 4),
			expected: null,
		},
	])("$name", ({usage, nowMs, expected}) => {
		expect(paceHeadline(usage, nowMs, ZONE)).toBe(expected);
	});
});

describe("reset labels", () => {
	it("formats the session reset as a time of day", () => {
		expect(formatSessionReset(Date.UTC(2026, 8, 28, 17, 40) / 1000, "UTC")).toBe("Resets at 5:40 PM");
	});

	it("formats the weekly reset with its weekday", () => {
		expect(formatWeeklyReset(Date.UTC(2026, 9, 2, 9, 0) / 1000, "UTC")).toBe("Resets Fri 9:00 AM");
	});
});
