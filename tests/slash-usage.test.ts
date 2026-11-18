import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {recordSlashUsage, resetSlashUsageThrottle, slashUsageScores} from "../src/lib/slash-usage";

const KEY = "slash-command-skill-usage:local";
const DAY = 86_400_000;

function stubStorage(): Map<string, string>
{
	const store = new Map<string, string>();
	vi.stubGlobal(
		"localStorage",
		{
			getItem: (key: string) => store.get(key) ?? null,
			setItem: (key: string, value: string) =>
			{
				store.set(key, value);
			},
			removeItem: (key: string) =>
			{
				store.delete(key);
			},
		},
	);
	return store;
}

beforeEach(() =>
{
	vi.useFakeTimers();
	vi.setSystemTime(1_000_000_000_000);
	resetSlashUsageThrottle();
});

afterEach(() =>
{
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("slash usage store (upstream mt / tA)", () =>
{
	it("counts a pick once per 60 s", () =>
	{
		const store = stubStorage();
		const t0 = Date.now();
		recordSlashUsage("local", "model");
		vi.setSystemTime(t0 + 59_999);
		recordSlashUsage("local", "model");
		expect(JSON.parse(store.get(KEY) ?? "null")).toStrictEqual(
			{
				model:
				{
					usageCount: 1,
					lastUsedAt: t0,
				},
			},
		);
		vi.setSystemTime(t0 + 60_000);
		recordSlashUsage("local", "model");
		expect(JSON.parse(store.get(KEY) ?? "null")).toStrictEqual(
			{
				model:
				{
					usageCount: 2,
					lastUsedAt: t0 + 60_000,
				},
			},
		);
	});

	it("decays the score by half a week, floored at a tenth", () =>
	{
		const store = stubStorage();
		const t0 = Date.now();
		store.set(
			KEY,
			JSON.stringify(
				{
					model:
					{
						usageCount: 2,
						lastUsedAt: t0,
					},
				},
			),
		);
		expect(slashUsageScores("local")("model")).toBe(2);
		vi.setSystemTime(t0 + 7 * DAY);
		expect(slashUsageScores("local")("model")).toBe(1);
		vi.setSystemTime(t0 + 70 * DAY);
		expect(slashUsageScores("local")("model")).toBe(0.2);
	});

	it("scores 0 for an unknown key, a missing store, or a throwing localStorage", () =>
	{
		const store = stubStorage();
		expect(slashUsageScores("local")("model")).toBe(0);
		store.set(
			KEY,
			JSON.stringify(
				{
					plan:
					{
						usageCount: 1,
						lastUsedAt: Date.now(),
					},
				},
			),
		);
		expect(slashUsageScores("local")("model")).toBe(0);
		vi.stubGlobal(
			"localStorage",
			{
				getItem: () =>
				{
					throw new Error("blocked");
				},
				setItem: () =>
				{
					throw new Error("blocked");
				},
			},
		);
		expect(slashUsageScores("local")("model")).toBe(0);
		expect(() =>
		{
			recordSlashUsage("local", "model");
		}).not.toThrow();
	});
});
