import {describe, expect, it} from "vite-plus/test";
import {matchesFamily, modelFamily, visibleScopedMeters} from "../src/lib/usage-family";
import type {ScopedUsage, UsageLimit} from "../src/lib/usage";

const RESETS_AT = "2026-11-10T08:00:00+00:00";

function limit(kind: string, percent: number, scope: UsageLimit["scope"] = null, group = "weekly"): UsageLimit
{
	return {
		kind,
		group,
		percent,
		severity: "normal",
		resets_at: RESETS_AT,
		scope,
		is_active: true,
	};
}

const FABLE_SCOPE =
{
	model:
	{
		id: null,
		display_name: "Fable",
	},
	surface: null,
};

function cached(limits: UsageLimit[]): ScopedUsage
{
	return {
		limits,
		shares: [],
		fetchedAt: "2026-11-06T12:00:00.000Z",
	};
}

describe("modelFamily (upstream Dr)", () =>
{
	it("names the family of current, dated and suffixed model ids", () =>
	{
		expect(
			{
				opus: modelFamily("claude-opus-5-5"),
				fable: modelFamily("claude-fable-1"),
				mythos: modelFamily("mythos-2"),
				dated: modelFamily("claude-3-5-sonnet-20241022"),
				suffixed: modelFamily("opus[1m]"),
				none: modelFamily(undefined),
			},
		).toStrictEqual(
			{
				opus:
				{
					family: "opus",
					excludeModelScoped: false,
				},
				fable:
				{
					family: "fable",
					excludeModelScoped: false,
				},
				mythos:
				{
					family: "mythos",
					excludeModelScoped: false,
				},
				dated:
				{
					family: "sonnet",
					excludeModelScoped: false,
				},
				suffixed:
				{
					family: "opus",
					excludeModelScoped: false,
				},
				none:
				{
					family: undefined,
					excludeModelScoped: false,
				},
			},
		);
	});
});

describe("matchesFamily (upstream Lm)", () =>
{
	it("hides another family's row, without Settings' mythos alias", () =>
	{
		const fable =
		{
			modelScope: "Fable",
		};
		expect(
			{
				opus: matchesFamily(fable, "opus"),
				fable: matchesFamily(fable, "fable"),
				mythos: matchesFamily(fable, "mythos"),
				unscoped: matchesFamily(
					{
						modelScope: undefined,
					},
					"opus",
				),
				noFamily: matchesFamily(fable, undefined),
				blank: matchesFamily(
					{
						modelScope: "  ",
					},
					"opus",
				),
			},
		).toStrictEqual(
			{
				opus: false,
				fable: true,
				mythos: false,
				unscoped: true,
				noFamily: true,
				blank: true,
			},
		);
	});
});

describe("visibleScopedMeters", () =>
{
	const limits = [
		limit("session", 10),
		limit("weekly_all", 46),
		limit("weekly_scoped", 0, FABLE_SCOPE),
		limit(
			"weekly_scoped",
			30,
			{
				model: null,
				surface:
				{
					display_name: "Cowork",
				},
			},
		),
	];

	it("keeps the model's own scoped rows and never the statusline or surface rows", () =>
	{
		expect(
			{
				fable: visibleScopedMeters(cached(limits), "claude-fable-1"),
				opus: visibleScopedMeters(cached(limits), "claude-opus-5-5"),
				none: visibleScopedMeters(null, "claude-fable-1"),
			},
		).toStrictEqual(
			{
				fable: [
					{
						key: "weekly_scoped-2",
						kind: "weekly_scoped",
						label: "Weekly · Fable",
						usedPercentage: 0,
						resetsAt: Date.parse(RESETS_AT) / 1000,
						modelScope: "Fable",
						surfaceScope: undefined,
					},
				],
				opus: [],
				none: [],
			},
		);
	});

	it("labels a non-weekly scoped row by its scope and an unscoped row as Usage", () =>
	{
		expect(
			visibleScopedMeters(
				cached([limit("monthly_scoped", 5, FABLE_SCOPE, "monthly"), limit("other", 7, null, "other")]),
				"claude-fable-1",
			).map((meter) => meter.label),
		).toStrictEqual(["Fable", "Usage"]);
	});
});
