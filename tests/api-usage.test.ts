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
		expect(() => UsageSummaryResponse.parse({fiveHour: null, sevenDay: null})).toThrow();
		expect(UsageSummaryResponse.parse(await requestUsage(directory))).toStrictEqual({
			fiveHour: {usedPct: 16, resetsAt: 1_790_000_000},
			sevenDay: {usedPct: 66, resetsAt: 1_790_300_000},
			updatedAt: new Date(1_700_000_000_000).toISOString(),
		});
	});
});

const HOUR = 3_600;
const DAY = 86_400;
// Monday 2026-09-28 12:00 UTC.
const NOW_SECONDS = Date.UTC(2026, 8, 28, 12, 0) / 1000;
const NOW_MS = NOW_SECONDS * 1000;

function summary(fiveHour: [number, number] | null, sevenDay: [number, number] | null) {
	const toWindow = (window: [number, number] | null) =>
		window === null ? null : {usedPct: window[0], resetsAt: NOW_SECONDS + window[1]};
	return {
		fiveHour: toWindow(fiveHour),
		sevenDay: toWindow(sevenDay),
		updatedAt: new Date(NOW_MS).toISOString(),
	} satisfies UsageSummary;
}

describe("paceHeadline", () => {
	it.each([
		{
			name: "weekly behind pace, resets tomorrow",
			usage: summary([16, 3 * HOUR], [66, 21 * HOUR]),
			expected: "On track. You should reach tomorrow’s reset with room to spare.",
		},
		{
			name: "weekly behind pace, resets later today",
			usage: summary(null, [50, 6 * HOUR]),
			expected: "On track. You should reach today’s reset with room to spare.",
		},
		{
			name: "weekly behind pace, resets in several days",
			usage: summary(null, [10, 4 * DAY]),
			expected: "On track. You should reach Friday’s reset with room to spare.",
		},
		{
			name: "weekly ahead of pace",
			usage: summary([10, 4 * HOUR], [80, 3 * DAY]),
			expected: "You may hit the limit before Thursday’s reset.",
		},
		{
			name: "session ahead of pace",
			usage: summary([70, 4 * HOUR], [20, 3 * DAY]),
			expected: "You may hit the limit before today’s reset.",
		},
		{
			name: "session only, on track",
			usage: summary([10, 4 * HOUR], null),
			expected: "On track. You should reach today’s reset with room to spare.",
		},
		{
			name: "weekly limit reached",
			usage: summary([100, 4 * HOUR], [100, 21 * HOUR]),
			expected: "You’ve hit the limit. It resets tomorrow at 9:00 AM.",
		},
		{
			name: "no rate limits",
			usage: summary(null, null),
			expected: null,
		},
	])("$name", ({usage, expected}) => {
		expect(paceHeadline(usage, NOW_MS, "UTC")).toBe(expected);
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
