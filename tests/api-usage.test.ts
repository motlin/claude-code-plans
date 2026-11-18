import {mkdtemp, rm, utimes, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import
{
	formatLimitCaption,
	formatWeeklyReset,
	usageVariant,
	paceHeadline,
	UsageSummaryResponse,
	type UsageSummary,
} from "../src/lib/usage";
import {handleUsageRequest} from "../src/routes/api/usage";

const RATE_LIMITS =
{
	five_hour:
	{
		used_percentage: 16,
		resets_at: 1_790_000_000,
	},
	seven_day:
	{
		used_percentage: 66,
		resets_at: 1_790_300_000,
	},
};

/** Fri Nov 6 2026 12:00 UTC: inside the week that resets Tue Nov 10 08:00 UTC. */
const NOW_MS = Date.UTC(2026, 10, 6, 12);
const ACCOUNT_UUID = "alice-account";
const WEEK_RESETS_AT = "2026-11-10T08:00:00.395665+00:00";

/** The live usage body's limits on 2026-11-06: the weekly limit and a Fable-only weekly limit. */
const LIVE_LIMITS = [
	{
		kind: "weekly_all",
		group: "weekly",
		percent: 45,
		severity: "normal",
		resets_at: WEEK_RESETS_AT,
		scope: null,
		is_active: true,
	},
	{
		kind: "weekly_scoped",
		group: "weekly",
		percent: 0,
		severity: "normal",
		resets_at: WEEK_RESETS_AT,
		scope:
		{
			model:
			{
				id: null,
				display_name: "Fable",
			},
			surface: null,
		},
		is_active: false,
	},
];

const LIVE_SHARES = [
	{
		limit_index: 1,
		used_percent_of_weekly: 0,
		allowance_percent_of_weekly: 50,
	},
];

let directory: string;
let home: string;

beforeEach(async () =>
{
	directory = await mkdtemp(join(tmpdir(), "api-usage-"));
	home = await mkdtemp(join(tmpdir(), "api-usage-home-"));
});

afterEach(async () =>
{
	await Promise.all(
		[directory, home].map(async (path) =>
			rm(
				path,
				{
					recursive: true,
					force: true,
				},
			),
		),
	);
});

async function writeStatusline(name: string, json: unknown, mtimeSeconds: number): Promise<void>
{
	const filePath = join(directory, name);
	await writeFile(filePath, typeof json === "string" ? json : JSON.stringify(json));
	await utimes(filePath, mtimeSeconds, mtimeSeconds);
}

async function writeClaudeJson(json: unknown): Promise<void>
{
	await writeFile(join(home, ".claude.json"), typeof json === "string" ? json : JSON.stringify(json));
}

function claudeJson(cache: Record<string, unknown>, accountUuid = ACCOUNT_UUID): unknown
{
	return {
		numStartups: 3,
		oauthAccount:
		{
			accountUuid,
		},
		cachedUsageUtilization:
		{
			fetchedAtMs: NOW_MS - 60_000,
			accountUuid: ACCOUNT_UUID,
			...cache,
		},
	};
}

/** The cached body as the CLI stores it: the live limits and shares among the other keys. */
const LIVE_UTILIZATION =
{
	five_hour: null,
	seven_day:
	{
		utilization: 45,
		resets_at: WEEK_RESETS_AT,
	},
	extra_usage: null,
	limits: LIVE_LIMITS,
	weekly_scoped_shares: LIVE_SHARES,
};

async function requestUsage(statuslineDirectory: string): Promise<unknown>
{
	const response = await handleUsageRequest(statuslineDirectory, home, NOW_MS);
	expect(response.status).toBe(200);
	expect(response.headers.get("Cache-Control")).toBe("private, max-age=0, must-revalidate");
	return response.json();
}

describe("GET /api/usage", () =>
{
	it("returns the rate limits of the most recently modified statusline", async () =>
	{
		await writeStatusline(
			"old-session.json",
			{
				rate_limits:
				{
					five_hour:
					{
						used_percentage: 90,
						resets_at: 1,
					},
					seven_day:
					{
						used_percentage: 95,
						resets_at: 2,
					},
				},
			},
			1_700_000_000,
		);
		await writeStatusline(
			"new-session.json",
			{
				rate_limits: RATE_LIMITS,
			},
			1_700_000_100,
		);

		expect(await requestUsage(directory)).toStrictEqual(
			{
				fiveHour:
				{
					usedPct: 16,
					resetsAt: 1_790_000_000,
				},
				sevenDay:
				{
					usedPct: 66,
					resetsAt: 1_790_300_000,
				},
				updatedAt: new Date(1_700_000_100_000).toISOString(),
				scoped: null,
			},
		);
	});

	it("reads the newest statusline when its rate_limits carry a gateway spend_limit", async () =>
	{
		await writeStatusline(
			"old-session.json",
			{
				rate_limits: RATE_LIMITS,
			},
			1_700_000_000,
		);
		await writeStatusline(
			"new-session.json",
			{
				rate_limits:
				{
					seven_day:
					{
						used_percentage: 46,
						resets_at: 1_794_297_600,
					},
					spend_limit:
					{
						used_percentage: 12,
						resets_at: 1_794_300_000,
						used_usd: 3.5,
						limit_usd: 50,
						period: "monthly",
					},
				},
			},
			1_700_000_100,
		);

		expect(await requestUsage(directory)).toStrictEqual(
			{
				fiveHour: null,
				sevenDay:
				{
					usedPct: 46,
					resetsAt: 1_794_297_600,
				},
				updatedAt: new Date(1_700_000_100_000).toISOString(),
				scoped: null,
			},
		);
	});

	it("returns null windows when the newest statusline has no rate_limits", async () =>
	{
		await writeStatusline(
			"old-session.json",
			{
				rate_limits: RATE_LIMITS,
			},
			1_700_000_000,
		);
		await writeStatusline(
			"new-session.json",
			{
				model:
				{
					id: "m",
				},
			},
			1_700_000_100,
		);

		expect(await requestUsage(directory)).toStrictEqual(
			{
				fiveHour: null,
				sevenDay: null,
				updatedAt: new Date(1_700_000_100_000).toISOString(),
				scoped: null,
			},
		);
	});

	it("returns null for a missing window", async () =>
	{
		await writeStatusline(
			"session.json",
			{
				rate_limits:
				{
					five_hour: RATE_LIMITS.five_hour,
				},
			},
			1_700_000_000,
		);

		expect(await requestUsage(directory)).toStrictEqual(
			{
				fiveHour:
				{
					usedPct: 16,
					resetsAt: 1_790_000_000,
				},
				sevenDay: null,
				updatedAt: new Date(1_700_000_000_000).toISOString(),
				scoped: null,
			},
		);
	});

	it("skips unreadable statuslines and non-json files", async () =>
	{
		await writeStatusline(
			"valid.json",
			{
				rate_limits: RATE_LIMITS,
			},
			1_700_000_000,
		);
		await writeStatusline("broken.json", "{not json", 1_700_000_100);
		await writeStatusline("notes.txt", "{}", 1_700_000_200);

		expect(await requestUsage(directory)).toStrictEqual(
			{
				fiveHour:
				{
					usedPct: 16,
					resetsAt: 1_790_000_000,
				},
				sevenDay:
				{
					usedPct: 66,
					resetsAt: 1_790_300_000,
				},
				updatedAt: new Date(1_700_000_000_000).toISOString(),
				scoped: null,
			},
		);
	});

	it("returns all nulls when there is no statusline data", async () =>
	{
		const empty =
		{
			fiveHour: null,
			sevenDay: null,
			updatedAt: null,
			scoped: null,
		};
		expect(await requestUsage(directory)).toStrictEqual(empty);
		expect(await requestUsage(join(directory, "missing"))).toStrictEqual(empty);
	});

	it("adds the model-scoped weekly rows and shares cached in ~/.claude.json", async () =>
	{
		await writeStatusline(
			"session.json",
			{
				rate_limits: RATE_LIMITS,
			},
			1_700_000_000,
		);
		await writeClaudeJson(
			claudeJson(
				{
					utilization: LIVE_UTILIZATION,
				},
			),
		);

		expect(await requestUsage(directory)).toStrictEqual(
			{
				fiveHour:
				{
					usedPct: 16,
					resetsAt: 1_790_000_000,
				},
				sevenDay:
				{
					usedPct: 66,
					resetsAt: 1_790_300_000,
				},
				updatedAt: new Date(1_700_000_000_000).toISOString(),
				scoped:
				{
					limits: LIVE_LIMITS,
					shares: LIVE_SHARES,
					fetchedAt: new Date(NOW_MS - 60_000).toISOString(),
				},
			},
		);
	});

	it.each([
		{
			name: "another account's cache",
			json: claudeJson(
				{
					utilization: LIVE_UTILIZATION,
				},
				"bob-account",
			),
		},
		{
			name: "a cache from a previous week",
			json: claudeJson(
				{
					utilization:
					{
						...LIVE_UTILIZATION,
						limits: LIVE_LIMITS.map((limit) => (
						{
							...limit,
							resets_at: "2026-11-03T08:00:00+00:00",
						})),
					},
				},
			),
		},
		{
			name: "a cache fetched in the future",
			json: claudeJson(
				{
					fetchedAtMs: NOW_MS + 60_000,
					utilization: LIVE_UTILIZATION,
				},
			),
		},
		{
			name: "a cache without a weekly_all row",
			json: claudeJson(
				{
					utilization:
					{
						...LIVE_UTILIZATION,
						limits: LIVE_LIMITS.slice(1),
					},
				},
			),
		},
		{
			name: "no cached usage",
			json:
			{
				oauthAccount:
				{
					accountUuid: ACCOUNT_UUID,
				},
			},
		},
		{
			name: "a malformed cache",
			json: claudeJson(
				{
					utilization:
					{
						limits: "soon",
					},
				},
			),
		},
		{
			name: "malformed JSON",
			json: "{not json",
		},
	])("leaves scoped null for $name", async ({json}) =>
	{
		await writeStatusline(
			"session.json",
			{
				rate_limits: RATE_LIMITS,
			},
			1_700_000_000,
		);
		await writeClaudeJson(json);

		expect(await requestUsage(directory)).toStrictEqual(
			{
				fiveHour:
				{
					usedPct: 16,
					resetsAt: 1_790_000_000,
				},
				sevenDay:
				{
					usedPct: 66,
					resetsAt: 1_790_300_000,
				},
				updatedAt: new Date(1_700_000_000_000).toISOString(),
				scoped: null,
			},
		);
	});

	it("reads the cache when neither the account nor the cache names an account uuid", async () =>
	{
		const cache =
		{
			fetchedAtMs: NOW_MS - 60_000,
			utilization: LIVE_UTILIZATION,
		};
		await writeClaudeJson(
			{
				cachedUsageUtilization: cache,
			},
		);

		expect(await requestUsage(directory)).toStrictEqual(
			{
				fiveHour: null,
				sevenDay: null,
				updatedAt: null,
				scoped:
				{
					limits: LIVE_LIMITS,
					shares: LIVE_SHARES,
					fetchedAt: new Date(NOW_MS - 60_000).toISOString(),
				},
			},
		);
	});

	it("validates with the strict client response schema", async () =>
	{
		await writeStatusline(
			"session.json",
			{
				rate_limits: RATE_LIMITS,
			},
			1_700_000_000,
		);
		expect(() =>
			UsageSummaryResponse.parse(
				{
					fiveHour: null,
					sevenDay: null,
				},
			),
		).toThrow("Invalid input: expected string, received undefined");
		await writeClaudeJson(
			claudeJson(
				{
					utilization: LIVE_UTILIZATION,
				},
			),
		);
		expect(UsageSummaryResponse.parse(await requestUsage(directory))).toStrictEqual(
			{
				fiveHour:
				{
					usedPct: 16,
					resetsAt: 1_790_000_000,
				},
				sevenDay:
				{
					usedPct: 66,
					resetsAt: 1_790_300_000,
				},
				updatedAt: new Date(1_700_000_000_000).toISOString(),
				scoped:
				{
					limits: LIVE_LIMITS,
					shares: LIVE_SHARES,
					fetchedAt: new Date(NOW_MS - 60_000).toISOString(),
				},
			},
		);
	});
});

// Upstream's pace headline, in New York time against a Tue Oct 27 2026 4:00 AM EDT weekly reset.
const ZONE = "America/New_York";
/** Epoch ms for an October 2026 wall-clock time in EDT (UTC−4). */
function edt(day: number, hour: number, minute = 0): number
{
	return Date.UTC(2026, 9, day, hour + 4, minute);
}
const WEEK_RESET_MS = edt(27, 4);

function weekly(usedPct: number, fiveHour: UsageSummary["fiveHour"] = null): UsageSummary
{
	return {
		fiveHour,
		sevenDay:
		{
			usedPct,
			resetsAt: WEEK_RESET_MS / 1000,
		},
		updatedAt: null,
		scoped: null,
	};
}

describe("paceHeadline", () =>
{
	it.each([
		{
			name: "zero",
			usage: weekly(0),
			nowMs: edt(22, 4),
			expected: "No usage yet. 100% of your weekly limit is available.",
		},
		{
			name: "fresh",
			usage: weekly(5),
			nowMs: edt(22, 4),
			expected: "Fresh week. 5% of your weekly limit used.",
		},
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
		{
			name: "limit hit, reset already past",
			usage: weekly(100),
			nowMs: edt(27, 5),
			expected: "Limit hit.",
		},
		{
			name: "session window ahead of pace, weekly on track",
			usage: weekly(
				20,
				{
					usedPct: 90,
					resetsAt: edt(23, 6) / 1000,
				},
			),
			nowMs: edt(23, 4),
			expected: "On track. You should reach Tuesday’s reset with room to spare.",
		},
		{
			name: "session window only",
			usage:
			{
				fiveHour:
				{
					usedPct: 10,
					resetsAt: edt(23, 6) / 1000,
				},
				sevenDay: null,
				updatedAt: null,
				scoped: null,
			},
			nowMs: edt(23, 4),
			expected: null,
		},
		{
			name: "no rate limits",
			usage:
			{
				fiveHour: null,
				sevenDay: null,
				updatedAt: null,
				scoped: null,
			},
			nowMs: edt(23, 4),
			expected: null,
		},
	])("$name", ({usage, nowMs, expected}) =>
	{
		expect(paceHeadline(usage, nowMs, ZONE)).toBe(expected);
	});
});

describe("reset labels", () =>
{
	const NY = "America/New_York";
	/** Tue Oct 20 2026 at the given EDT (UTC-4) wall time. */
	const tue = (hour: number, minute = 0) => Date.UTC(2026, 9, 20, hour + 4, minute);
	const seconds = (ms: number) => ms / 1000;

	it.each([
		{
			name: "same calendar day",
			resetsAt: seconds(tue(17, 40)),
			weekday: "short" as const,
			expected: "Resets at 5:40 PM",
		},
		{
			name: "session reset tomorrow",
			resetsAt: seconds(tue(25)),
			weekday: "short" as const,
			expected: "Resets Wed 1:00 AM",
		},
		{
			name: "weekly reset later this week",
			resetsAt: seconds(tue(25)),
			weekday: "long" as const,
			expected: "Resets Wednesday 1:00 AM",
		},
		{
			name: "exactly seven days away",
			resetsAt: seconds(tue(4) + 7 * 86_400_000),
			weekday: "long" as const,
			expected: "Resets Oct 27, 4:00 AM",
		},
		{
			name: "past reset",
			resetsAt: seconds(tue(3)),
			weekday: "long" as const,
			expected: "Starts with your first message",
		},
	])("$name", ({resetsAt, weekday, expected}) =>
	{
		expect(formatLimitCaption(resetsAt, tue(4), weekday, NY)).toBe(expected);
	});

	it("formats the composer weekly reset with its weekday", () =>
	{
		expect(formatWeeklyReset(Date.UTC(2026, 9, 2, 9, 0) / 1000, "UTC")).toBe("Resets Fri 9:00 AM");
	});
});

describe("usageVariant", () =>
{
	it.each([
		{
			percent: 0,
			expected: "accent",
		},
		{
			percent: 74,
			expected: "accent",
		},
		{
			percent: 75,
			expected: "warning",
		},
		{
			percent: 89,
			expected: "warning",
		},
		{
			percent: 90,
			expected: "danger",
		},
		{
			percent: 100,
			expected: "danger",
		},
	])("$percent% → $expected", ({percent, expected}) =>
	{
		expect(usageVariant(percent)).toBe(expected);
	});
});
