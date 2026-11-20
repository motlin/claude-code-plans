import {describe, expect, it} from "vite-plus/test";
import type {ContextBreakdown} from "../src/lib/context-breakdown";
import
{
	detectStaleEngine,
	latestRecordVersion,
	rescaleBreakdown,
	staleEngineForBreakdown,
	type StaleEngineInputs,
} from "../src/lib/stale-engine";

const OLD_ENGINE: StaleEngineInputs =
{
	rawMaxTokens: 200_000,
	autocompactSource: "auto",
	model: "claude-opus-5",
	engineVersion: "2.1.218",
	catalogSupports1m: true,
	launchedModelWindow: null,
	surfaceAutoCompactWindow: null,
};

describe("detectStaleEngine", () =>
{
	it("copies upstream Ih's branches", () =>
	{
		expect(
			{
				reported1m: detectStaleEngine(
					{
						...OLD_ENGINE,
						rawMaxTokens: 1_000_000,
					},
				),
				unknownModelLaunched1m: detectStaleEngine(
					{
						...OLD_ENGINE,
						autocompactSource: "unknown-model",
						launchedModelWindow: 1_000_000,
					},
				),
				unknownModelLaunched200k: detectStaleEngine(
					{
						...OLD_ENGINE,
						autocompactSource: "unknown-model",
						launchedModelWindow: 200_000,
					},
				),
				unknownModelNoLaunch: detectStaleEngine(
					{
						...OLD_ENGINE,
						autocompactSource: "unknown-model",
					},
				),
				oldEngine: detectStaleEngine(OLD_ENGINE),
				oldEngineSurfaceWindow: detectStaleEngine(
					{
						...OLD_ENGINE,
						surfaceAutoCompactWindow: 500_000,
					},
				),
				oldEngineNo1mCatalog: detectStaleEngine(
					{
						...OLD_ENGINE,
						catalogSupports1m: false,
					},
				),
				oldEngineQualifiedModel: detectStaleEngine(
					{
						...OLD_ENGINE,
						model: "claude-opus-5-20261001[1m]",
					},
				),
				olderMinor: detectStaleEngine(
					{
						...OLD_ENGINE,
						engineVersion: "2.0.900",
					},
				),
				minEngine: detectStaleEngine(
					{
						...OLD_ENGINE,
						engineVersion: "2.1.219",
					},
				),
				newerEngine: detectStaleEngine(
					{
						...OLD_ENGINE,
						engineVersion: "2.10.0",
					},
				),
				modelDefault: detectStaleEngine(
					{
						...OLD_ENGINE,
						autocompactSource: "model-default",
					},
				),
				noSource: detectStaleEngine(
					{
						...OLD_ENGINE,
						autocompactSource: undefined,
					},
				),
				noEngineVersion: detectStaleEngine(
					{
						...OLD_ENGINE,
						engineVersion: null,
					},
				),
				untrackedModel: detectStaleEngine(
					{
						...OLD_ENGINE,
						model: "claude-sonnet-5",
					},
				),
				noModel: detectStaleEngine(
					{
						...OLD_ENGINE,
						model: undefined,
					},
				),
			},
		).toStrictEqual(
			{
				reported1m: null,
				unknownModelLaunched1m:
				{
					max: 200_000,
					enforced: true,
				},
				unknownModelLaunched200k: null,
				unknownModelNoLaunch: null,
				oldEngine:
				{
					max: 1_000_000,
					enforced: false,
				},
				oldEngineSurfaceWindow:
				{
					max: 500_000,
					enforced: false,
				},
				oldEngineNo1mCatalog: null,
				oldEngineQualifiedModel:
				{
					max: 1_000_000,
					enforced: false,
				},
				olderMinor:
				{
					max: 1_000_000,
					enforced: false,
				},
				minEngine: null,
				newerEngine: null,
				modelDefault: null,
				noSource: null,
				noEngineVersion: null,
				untrackedModel: null,
				noModel: null,
			},
		);
	});
});

const BREAKDOWN: ContextBreakdown =
{
	categories: [
		{
			name: "Messages",
			tokens: 100_000,
			kind: "used",
		},
		{
			name: "Free space",
			tokens: 100_000,
			kind: "free",
		},
	],
	totalTokens: 100_000,
	rawMaxTokens: 200_000,
	percentage: 50,
	mcpTools: [],
	memoryFiles: [],
	agents: [],
	fetchedAt: "2026-11-19T10:00:00.000Z",
	source: "mod",
	autoCompactThreshold: 200_000,
	autocompactSource: "auto",
	model: "claude-opus-5",
};

describe("staleEngineForBreakdown", () =>
{
	it("reads the launched window from the local model table and needs a mod breakdown's source", () =>
	{
		expect(
			{
				oldEngine: staleEngineForBreakdown(BREAKDOWN, "2.1.100"),
				freshEngine: staleEngineForBreakdown(BREAKDOWN, "2.1.219"),
				unknownModel: staleEngineForBreakdown(
					{
						...BREAKDOWN,
						autocompactSource: "unknown-model",
						model: "claude-opus-5-5",
					},
					"2.1.400",
				),
				unknownSmallModel: staleEngineForBreakdown(
					{
						...BREAKDOWN,
						autocompactSource: "unknown-model",
						model: "claude-haiku-4-5",
					},
					"2.1.400",
				),
				contextCommand: staleEngineForBreakdown(
					{
						...BREAKDOWN,
						source: "context-command",
						autocompactSource: undefined,
						model: undefined,
					},
					"2.1.100",
				),
			},
		).toStrictEqual(
			{
				oldEngine:
				{
					max: 1_000_000,
					enforced: false,
				},
				freshEngine: null,
				unknownModel:
				{
					max: 200_000,
					enforced: true,
				},
				unknownSmallModel: null,
				contextCommand: null,
			},
		);
	});
});

describe("rescaleBreakdown", () =>
{
	it("measures the breakdown against the corrected window, growing Free space by the difference (upstream st)", () =>
	{
		expect(rescaleBreakdown(BREAKDOWN, 1_000_000)).toStrictEqual(
			{
				...BREAKDOWN,
				categories: [
					{
						name: "Messages",
						tokens: 100_000,
						kind: "used",
					},
					{
						name: "Free space",
						tokens: 900_000,
						kind: "free",
					},
				],
				rawMaxTokens: 1_000_000,
				percentage: 10,
			},
		);
	});
});

describe("latestRecordVersion", () =>
{
	it("reads the newest record's CLI version", () =>
	{
		expect(
			{
				newest: latestRecordVersion([
					{
						version: "2.1.100",
					},
					{
						version: "2.1.218",
					},
					{
						type: "summary",
					},
					null,
				]),
				none: latestRecordVersion([
					{
						type: "summary",
					},
				]),
			},
		).toStrictEqual(
			{
				newest: "2.1.218",
				none: null,
			},
		);
	});
});
