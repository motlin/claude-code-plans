import {describe, expect, it} from "vite-plus/test";
import
{
	autoCompactHint,
	autoCompactThreshold,
	COMPACT_DISABLED_REASON,
	compactActionState,
	type CompactActionGate,
} from "../src/lib/compact-action";

const LIVE: CompactActionGate =
{
	contextPct: 66,
	hasHandler: true,
	reach: "live",
	responding: false,
	compacting: false,
};

describe("compactActionState", () =>
{
	it("hides the row under half the window and enables it from 50%", () =>
	{
		expect(
			[49, 50, 66].map((contextPct) =>
				compactActionState(
					{
						...LIVE,
						contextPct,
					},
				),
			),
		).toStrictEqual([
			{
				kind: "hidden",
			},
			{
				kind: "enabled",
			},
			{
				kind: "enabled",
			},
		]);
	});

	it("disables while replying or detached, preferring reconnect", () =>
	{
		expect([
			compactActionState(
				{
					...LIVE,
					responding: true,
				},
			),
			compactActionState(
				{
					...LIVE,
					reach: "detached",
				},
			),
			compactActionState(
				{
					...LIVE,
					reach: "detached",
					responding: true,
				},
			),
		]).toStrictEqual([
			{
				kind: "disabled",
				reason: "replying",
			},
			{
				kind: "disabled",
				reason: "reconnect",
			},
			{
				kind: "disabled",
				reason: "reconnect",
			},
		]);
	});

	it("hides when dormant, compacting, without a handler or without usage", () =>
	{
		expect([
			compactActionState(
				{
					...LIVE,
					reach: "dormant",
				},
			),
			compactActionState(
				{
					...LIVE,
					compacting: true,
				},
			),
			compactActionState(
				{
					...LIVE,
					hasHandler: false,
				},
			),
			compactActionState(
				{
					...LIVE,
					contextPct: null,
				},
			),
		]).toStrictEqual([
			{
				kind: "hidden",
			},
			{
				kind: "hidden",
			},
			{
				kind: "hidden",
			},
			{
				kind: "hidden",
			},
		]);
	});

	it("names upstream's disabled reasons", () =>
	{
		expect(COMPACT_DISABLED_REASON).toStrictEqual(
			{
				replying: "Available when Claude finishes this turn",
				reconnect: "Available when reconnected",
			},
		);
	});
});

describe("autoCompactThreshold", () =>
{
	it("ports upstream Xa", () =>
	{
		expect([
			autoCompactThreshold(
				{
					rawMaxTokens: 1_000_000,
					autoCompactThreshold: 967_000,
					isAutoCompactEnabled: true,
					autocompactBufferTokens: null,
				},
			),
			autoCompactThreshold(
				{
					rawMaxTokens: 1_000_000,
					autoCompactThreshold: null,
					isAutoCompactEnabled: true,
					autocompactBufferTokens: 33_000,
				},
			),
			autoCompactThreshold(
				{
					rawMaxTokens: 1_000_000,
					autoCompactThreshold: 967_000,
					isAutoCompactEnabled: false,
					autocompactBufferTokens: 33_000,
				},
			),
			autoCompactThreshold(
				{
					rawMaxTokens: 1_000_000,
					autoCompactThreshold: 1_000_000,
					isAutoCompactEnabled: true,
					autocompactBufferTokens: null,
				},
			),
			autoCompactThreshold(
				{
					rawMaxTokens: 0,
					autoCompactThreshold: 967_000,
					isAutoCompactEnabled: true,
					autocompactBufferTokens: null,
				},
			),
			autoCompactThreshold(
				{
					rawMaxTokens: 1_000_000,
					autoCompactThreshold: null,
					isAutoCompactEnabled: true,
					autocompactBufferTokens: 1_000_000,
				},
			),
		]).toStrictEqual([967_000, 967_000, null, null, null, null]);
	});
});

describe("autoCompactHint", () =>
{
	it("counts down to auto-compact in two significant digits", () =>
	{
		expect([
			autoCompactHint(967_000, 656_200),
			autoCompactHint(967_000, 940_000),
			autoCompactHint(967_000, 0),
			autoCompactHint(2_000_000, 455_000),
			autoCompactHint(967_000, 937_000),
			autoCompactHint(null, 656_200),
			autoCompactHint(967_000, null),
			autoCompactHint(Number.POSITIVE_INFINITY, 1),
		]).toStrictEqual([
			"310k until auto-compact",
			"Auto-compacts soon",
			"960k until auto-compact",
			"1.5M until auto-compact",
			"30k until auto-compact",
			null,
			null,
			null,
		]);
	});
});
