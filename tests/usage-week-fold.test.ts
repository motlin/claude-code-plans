import {describe, expect, it} from "vite-plus/test";
import {matchesModelFamily, scopedModelName, type UsageLimit, weeklyScopedShares} from "../src/lib/usage";

const RESETS_AT = "2026-11-10T08:00:00.395665+00:00";

function weeklyAll(percent: number): UsageLimit
{
	return {
		kind: "weekly_all",
		group: "weekly",
		percent,
		severity: "normal",
		resets_at: RESETS_AT,
		scope: null,
		is_active: true,
	};
}

function scoped(displayName: string, percent = 0): UsageLimit
{
	return {
		kind: "weekly_scoped",
		group: "weekly",
		percent,
		severity: "normal",
		resets_at: RESETS_AT,
		scope:
		{
			model:
			{
				id: null,
				display_name: displayName,
			},
			surface: null,
		},
		is_active: false,
	};
}

function share(limitIndex: number, used: number, allowance: number)
{
	return {
		limit_index: limitIndex,
		used_percent_of_weekly: used,
		allowance_percent_of_weekly: allowance,
	};
}

describe("weeklyScopedShares (upstream Te)", () =>
{
	it("keeps the live payload's Fable share", () =>
	{
		expect(weeklyScopedShares([weeklyAll(45), scoped("Fable")], [share(1, 0, 50)])).toStrictEqual(
			{
				weeklyAllIndex: 0,
				shares: [
					{
						limitIndex: 1,
						used: 0,
						allowance: 50,
					},
				],
			},
		);
	});

	it("drops zero allowances, duplicates, bad indexes, non-scoped targets and non-finite percents", () =>
	{
		const limits = [weeklyAll(45), scoped("Fable"), weeklyAll(10), scoped("Opus")];
		expect(
			weeklyScopedShares(limits, [
				share(1, 5, 0),
				share(1, 5, 40),
				share(1, 9, 40),
				share(9, 5, 40),
				share(-1, 5, 40),
				share(1.5, 5, 40),
				share(2, 5, 40),
				share(3, Number.NaN, 40),
				share(3, 5, -1),
			]),
		).toStrictEqual(
			{
				weeklyAllIndex: 0,
				shares: [
					{
						limitIndex: 1,
						used: 5,
						allowance: 40,
					},
				],
			},
		);
	});

	it("caps the shares cumulatively by the weekly percent in limit order", () =>
	{
		expect(
			weeklyScopedShares([weeklyAll(45), scoped("Fable"), scoped("Opus")], [share(2, 30, 60), share(1, 30, 60)]),
		).toStrictEqual(
			{
				weeklyAllIndex: 0,
				shares: [
					{
						limitIndex: 1,
						used: 30,
						allowance: 60,
					},
					{
						limitIndex: 2,
						used: 15,
						allowance: 60,
					},
				],
			},
		);
	});

	it("rounds the allowance and caps used by the weekly percent and the allowance", () =>
	{
		expect(weeklyScopedShares([weeklyAll(45), scoped("Fable")], [share(1, 70, 50.4)])).toStrictEqual(
			{
				weeklyAllIndex: 0,
				shares: [
					{
						limitIndex: 1,
						used: 45,
						allowance: 50,
					},
				],
			},
		);
	});

	it("returns null without a weekly_all row, shares, or a surviving entry", () =>
	{
		expect(
			{
				noWeekly: weeklyScopedShares([scoped("Fable")], [share(0, 0, 50)]),
				noShares: weeklyScopedShares([weeklyAll(45), scoped("Fable")], []),
				nullShares: weeklyScopedShares([weeklyAll(45), scoped("Fable")], null),
				noneSurvive: weeklyScopedShares([weeklyAll(45), scoped("Fable")], [share(1, 0, 0)]),
				nanWeekly: weeklyScopedShares([weeklyAll(Number.NaN), scoped("Fable")], [share(1, 0, 50)]),
			},
		).toStrictEqual(
			{
				noWeekly: null,
				noShares: null,
				nullShares: null,
				noneSurvive: null,
				nanWeekly: null,
			},
		);
	});
});

describe("matchesModelFamily (upstream Ee)", () =>
{
	it("matches the model family against the scoped row's name, with the mythos alias", () =>
	{
		const fable = scoped("Fable");
		expect(
			{
				fable: matchesModelFamily(fable, "claude-fable-1"),
				mythos: matchesModelFamily(fable, "mythos-2"),
				opus: matchesModelFamily(fable, "claude-opus-5-5"),
				claude: matchesModelFamily(fable, "claude"),
				bareOpus: matchesModelFamily(fable, "opus"),
				none: matchesModelFamily(fable, null),
				weeklyAll: matchesModelFamily(weeklyAll(45), "claude-fable-1"),
			},
		).toStrictEqual(
			{
				fable: true,
				mythos: true,
				opus: false,
				claude: false,
				bareOpus: false,
				none: false,
				weeklyAll: false,
			},
		);
	});
});

describe("scopedModelName (upstream J)", () =>
{
	it("names only weekly_scoped rows with a non-blank model", () =>
	{
		expect(
			{
				blank: scopedModelName(scoped("  ")),
				padded: scopedModelName(scoped(" Fable ")),
				weeklyAll: scopedModelName(weeklyAll(45)),
			},
		).toStrictEqual(
			{
				blank: undefined,
				padded: "Fable",
				weeklyAll: undefined,
			},
		);
	});
});
