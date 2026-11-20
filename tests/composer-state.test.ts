import {describe, expect, it, vi} from "vite-plus/test";
import {StatuslineRateLimitsStrictSchema, StatuslineSchema, type Statusline} from "../src/lib/api/statusline";
import
{
	type ComposerStateSources,
	contextRingPercent,
	formatContextRingSummary,
	formatResetLabel,
	formatUsageAriaLabel,
	formatUsageTooltipRows,
	lastAssistantEffortFromRecords,
	lastAssistantModelFromRecords,
	lastAssistantUsageFromRecords,
	lastPermissionModeFromRecords,
	resolveComposerState,
	USAGE_RING_CIRCUMFERENCE,
	usageRingDashoffset,
	usageRingMode,
	usageRingPercent,
	usageRingSeverity,
	withAccountLimits,
	withComposerAccountLimits,
} from "../src/lib/composer-state";
import
{
	type ComposerDefaultsRequestDependencies,
	type ComposerStateDependencies,
	getComposerDefaults,
	getComposerState,
	handleComposerDefaultsRequest,
	managedSettingsPath,
} from "../src/lib/composer-state-server";
import {resolveDraftBaseMode} from "../src/lib/folder-permission-mode";
import {handleComposerStateRequest} from "../src/routes/api/sessions.$id.composer-state";

const NOW_MS = Date.UTC(2026, 8, 29, 12, 0, 0);
const NOW_SEC = NOW_MS / 1000;

const ALICE_STATUSLINE: Statusline = StatuslineSchema.parse(
	{
		model:
		{
			id: "claude-opus-5-5",
			display_name: "Opus 5.5",
		},
		context_window:
		{
			total_input_tokens: 190_200,
			total_output_tokens: 157,
			context_window_size: 1_000_000,
			current_usage:
			{
				input_tokens: 200,
				output_tokens: 157,
				cache_creation_input_tokens: 1_000,
				cache_read_input_tokens: 189_000,
			},
			used_percentage: 19,
			remaining_percentage: 81,
		},
		rate_limits:
		{
			five_hour:
			{
				used_percentage: 10,
				resets_at: NOW_SEC + 4 * 3600 + 11 * 60,
			},
			seven_day:
			{
				used_percentage: 65,
				resets_at: NOW_SEC + 14 * 3600 + 31 * 60,
			},
		},
	},
);

const EMPTY_SOURCES: ComposerStateSources =
{
	hookPermissionMode: null,
	jsonlPermissionMode: null,
	settingsDefaultMode: null,
	statuslineModel: null,
	statuslineModelId: null,
	lastAssistantModel: null,
	lastAssistantUsage: null,
	lastAssistantEffort: null,
	fastMode: false,
	fastModeBlocked: null,
	settingsModel: null,
	settingsModelManaged: false,
	settingsAvailableModels: null,
	settingsEffortLevel: null,
	statusline: null,
	statuslineUpdatedAt: null,
};

describe("resolveComposerState precedence", () =>
{
	it("carries the session's fast mode through", () =>
	{
		expect(
			{
				on: resolveComposerState(
					{
						...EMPTY_SOURCES,
						fastMode: true,
					},
				).fastMode,
				off: resolveComposerState(EMPTY_SOURCES).fastMode,
			},
		).toStrictEqual(
			{
				on: true,
				off: false,
			},
		);
	});

	it("carries the settings model as the menu's default, with its managed flag, and the availableModels allowlist", () =>
	{
		const availableModels =
		{
			value: ["opus", "sonnet"],
			source: "user",
			path: "~/.claude/settings.json",
		};
		const pick = (sources: Partial<ComposerStateSources>) =>
		{
			const state = resolveComposerState(
				{
					...EMPTY_SOURCES,
					...sources,
				},
			);
			return {
				settingsDefault: state.settingsDefault,
				availableModels: state.availableModels,
			};
		};
		expect(
			{
				set: pick(
					{
						settingsModel: "opus",
						settingsAvailableModels: availableModels,
					},
				),
				managed: pick(
					{
						settingsModel: "claude-sonnet-5",
						settingsModelManaged: true,
					},
				),
				unset: pick({}),
			},
		).toStrictEqual(
			{
				set:
				{
					settingsDefault:
					{
						id: "claude-opus-5-5",
						managed: false,
					},
					availableModels,
				},
				managed:
				{
					settingsDefault:
					{
						id: "claude-sonnet-5",
						managed: true,
					},
					availableModels: null,
				},
				unset:
				{
					settingsDefault: null,
					availableModels: null,
				},
			},
		);
	});

	it("turns fast mode off and carries the block while the CLI can't use it", () =>
	{
		const blocked =
		{
			code: "disabled_by_env" as const,
			line: "Off for this session",
			reason: "An environment variable turns fast mode off in this session.",
		};
		const state = resolveComposerState(
			{
				...EMPTY_SOURCES,
				fastMode: true,
				fastModeBlocked: blocked,
			},
		);
		expect(
			{
				fastMode: state.fastMode,
				fastModeBlocked: state.fastModeBlocked,
			},
		).toStrictEqual(
			{
				fastMode: false,
				fastModeBlocked: blocked,
			},
		);
	});

	it.each([
		{
			hook: "plan",
			jsonl: "acceptEdits",
			settings: "auto",
			expected:
			{
				id: "plan",
				label: "Plan",
			},
		},
		{
			hook: null,
			jsonl: "acceptEdits",
			settings: "auto",
			expected:
			{
				id: "acceptEdits",
				label: "Accept edits",
			},
		},
		{
			hook: "",
			jsonl: "default",
			settings: "auto",
			expected:
			{
				id: "default",
				label: "Manual",
			},
		},
		{
			hook: null,
			jsonl: null,
			settings: "auto",
			expected:
			{
				id: "auto",
				label: "Auto",
			},
		},
		{
			hook: "bypassPermissions",
			jsonl: null,
			settings: null,
			expected:
			{
				id: "bypassPermissions",
				label: "Bypass permissions",
			},
		},
		{
			hook: "dontAsk",
			jsonl: null,
			settings: null,
			expected:
			{
				id: "dontAsk",
				label: "Don't ask",
			},
		},
		{
			hook: null,
			jsonl: null,
			settings: null,
			expected: null,
		},
	])("mode: hook=$hook jsonl=$jsonl settings=$settings", ({hook, jsonl, settings, expected}) =>
	{
		const state = resolveComposerState(
			{
				...EMPTY_SOURCES,
				hookPermissionMode: hook,
				jsonlPermissionMode: jsonl,
				settingsDefaultMode: settings,
			},
		);
		expect(state.mode).toStrictEqual(expected);
	});

	it.each([
		{
			statusline:
			{
				id: "claude-opus-5-5",
				name: "Opus 5.5",
			},
			assistant: "claude-sonnet-4-6",
			settings: "haiku",
			expected:
			{
				model: "Opus 5.5",
				modelId: "claude-opus-5-5",
			},
		},
		{
			statusline: null,
			assistant: "claude-sonnet-4-6",
			settings: "haiku",
			expected:
			{
				model: "Sonnet 4.6",
				modelId: "claude-sonnet-4-6",
			},
		},
		{
			statusline: null,
			assistant: "claude-haiku-4-5-20251001",
			settings: null,
			expected:
			{
				model: "Haiku 4.5",
				modelId: "claude-haiku-4-5-20251001",
			},
		},
		{
			statusline: null,
			assistant: null,
			settings: "fable",
			expected:
			{
				model: "Fable 5.2",
				modelId: "claude-fable-5-2",
			},
		},
		{
			statusline: null,
			assistant: null,
			settings: "claude-opus-4-8[1m]",
			expected:
			{
				model: "Opus 4.8",
				modelId: "claude-opus-4-8[1m]",
			},
		},
		{
			statusline: null,
			assistant: null,
			settings: null,
			expected:
			{
				model: "Opus 5.5",
				modelId: "claude-opus-5-5",
			},
		},
	])(
		"model: statusline=$statusline.id assistant=$assistant settings=$settings",
		({statusline, assistant, settings, expected}) =>
		{
			const state = resolveComposerState(
				{
					...EMPTY_SOURCES,
					statuslineModel: statusline?.name ?? null,
					statuslineModelId: statusline?.id ?? null,
					lastAssistantModel: assistant,
					settingsModel: settings,
				},
			);
			expect(
				{
					model: state.model,
					modelId: state.modelId,
				},
			).toStrictEqual(expected);
		},
	);

	it.each([
		{
			settings: "low",
			expected:
			{
				id: "low",
				label: "Low",
			},
		},
		{
			settings: "medium",
			expected:
			{
				id: "medium",
				label: "Medium",
			},
		},
		{
			settings: "xhigh",
			expected:
			{
				id: "xhigh",
				label: "Extra-high",
			},
		},
		{
			settings: "max",
			expected:
			{
				id: "max",
				label: "Max",
			},
		},
		{
			settings: null,
			expected:
			{
				id: "medium",
				label: "Medium",
			},
		},
	])("effort: settings=$settings", ({settings, expected}) =>
	{
		const state = resolveComposerState(
			{
				...EMPTY_SOURCES,
				settingsEffortLevel: settings,
			},
		);
		expect(state.effort).toStrictEqual(expected);
	});

	it.each([
		{
			modelId: "claude-opus-4-7",
			expected:
			{
				id: "xhigh",
				label: "Extra-high",
			},
		},
		{
			modelId: "claude-fable-5-1",
			expected:
			{
				id: "high",
				label: "High",
			},
		},
		{
			modelId: "claude-haiku-4-5-20251001",
			expected:
			{
				id: "high",
				label: "High",
			},
		},
	])("effort: with no pick, the model's own default for $modelId", ({modelId, expected}) =>
	{
		const state = resolveComposerState(
			{
				...EMPTY_SOURCES,
				statuslineModelId: modelId,
			},
		);
		expect(state.effort).toStrictEqual(expected);
	});

	it("effort: the session's newest turn wins over settings", () =>
	{
		const state = resolveComposerState(
			{
				...EMPTY_SOURCES,
				lastAssistantEffort: "medium",
				settingsEffortLevel: "xhigh",
			},
		);
		expect(state.effort).toStrictEqual(
			{
				id: "medium",
				label: "Medium",
			},
		);
	});

	it("usage comes from the statusline context window and rate limits", () =>
	{
		const state = resolveComposerState(
			{
				...EMPTY_SOURCES,
				statusline: ALICE_STATUSLINE,
				statuslineUpdatedAt: "2026-09-29T09:00:00.000Z",
			},
		);
		expect(state.usage).toStrictEqual(
			{
				contextTokens: 190_200,
				contextWindowSize: 1_000_000,
				contextPercent: 19,
				fiveHour:
				{
					usedPercentage: 10,
					resetsAt: NOW_SEC + 4 * 3600 + 11 * 60,
				},
				weekly:
				{
					usedPercentage: 65,
					resetsAt: NOW_SEC + 14 * 3600 + 31 * 60,
				},
				updatedAt: "2026-09-29T09:00:00.000Z",
			},
		);
	});

	it("usage is null without a statusline or transcript usage", () =>
	{
		expect(resolveComposerState(EMPTY_SOURCES).usage).toBeNull();
	});

	const assistantRecord = (model: string, timestamp: string, usage: Record<string, number>) => (
	{
		type: "assistant",
		timestamp,
		message:
		{
			role: "assistant",
			model,
			usage,
		},
	});
	const CACHED_USAGE =
	{
		input_tokens: 4,
		cache_creation_input_tokens: 2_996,
		cache_read_input_tokens: 47_000,
		output_tokens: 900,
	};

	it.each([
		{
			name: "no assistant record",
			records: [
				{
					type: "user",
					message:
					{
						role: "user",
						content: "hi",
					},
				},
			],
			expected: null,
		},
		{
			name: "assistant with cache tokens on a 200k model",
			records: [
				assistantRecord(
					"claude-haiku-4-5-20251001",
					"2026-09-29T08:00:00.000Z",
					{
						input_tokens: 1,
						output_tokens: 1,
					},
				),
				assistantRecord("claude-haiku-4-5-20251001", "2026-09-29T08:30:00.000Z", CACHED_USAGE),
				{
					type: "assistant",
					timestamp: "2026-09-29T08:31:00.000Z",
					message:
					{
						model: "<synthetic>",
						usage: {},
					},
				},
				{
					type: "user",
					timestamp: "2026-09-29T08:32:00.000Z",
					message:
					{
						role: "user",
						content: "next",
					},
				},
			],
			expected:
			{
				contextTokens: 50_000,
				contextWindowSize: 200_000,
				contextPercent: 25,
				estimatedWindow: true,
				fiveHour: null,
				weekly: null,
				updatedAt: "2026-09-29T08:30:00.000Z",
			},
		},
		{
			name: "1M model",
			records: [assistantRecord("claude-opus-5-5", "2026-09-29T07:00:00.000Z", CACHED_USAGE)],
			expected:
			{
				contextTokens: 50_000,
				contextWindowSize: 1_000_000,
				contextPercent: 5,
				estimatedWindow: true,
				fiveHour: null,
				weekly: null,
				updatedAt: "2026-09-29T07:00:00.000Z",
			},
		},
		{
			name: "[1m] suffix",
			records: [assistantRecord("claude-sonnet-4-6[1m]", "2026-09-29T07:00:00.000Z", CACHED_USAGE)],
			expected:
			{
				contextTokens: 50_000,
				contextWindowSize: 1_000_000,
				contextPercent: 5,
				estimatedWindow: true,
				fiveHour: null,
				weekly: null,
				updatedAt: "2026-09-29T07:00:00.000Z",
			},
		},
	])("usage falls back to the transcript: $name", ({records, expected}) =>
	{
		const state = resolveComposerState(
			{
				...EMPTY_SOURCES,
				lastAssistantModel: lastAssistantModelFromRecords(records),
				lastAssistantUsage: lastAssistantUsageFromRecords(records),
			},
		);
		expect(state.usage).toStrictEqual(expected);
	});

	it("the statusline wins over transcript usage", () =>
	{
		const state = resolveComposerState(
			{
				...EMPTY_SOURCES,
				lastAssistantModel: "claude-haiku-4-5-20251001",
				lastAssistantUsage:
				{
					contextTokens: 50_000,
					timestamp: "2026-09-29T08:30:00.000Z",
				},
				statusline: ALICE_STATUSLINE,
				statuslineUpdatedAt: "2026-09-29T09:00:00.000Z",
			},
		);
		expect(state.usage).toStrictEqual(
			{
				contextTokens: 190_200,
				contextWindowSize: 1_000_000,
				contextPercent: 19,
				fiveHour:
				{
					usedPercentage: 10,
					resetsAt: NOW_SEC + 4 * 3600 + 11 * 60,
				},
				weekly:
				{
					usedPercentage: 65,
					resetsAt: NOW_SEC + 14 * 3600 + 31 * 60,
				},
				updatedAt: "2026-09-29T09:00:00.000Z",
			},
		);
	});
});

describe("transcript record extraction", () =>
{
	const records = [
		{
			type: "permission-mode",
			permissionMode: "plan",
			sessionId: "alice",
		},
		{
			type: "user",
			permissionMode: "acceptEdits",
			message:
			{
				role: "user",
				content: "hi",
			},
		},
		{
			type: "assistant",
			message:
			{
				role: "assistant",
				model: "claude-opus-4-8",
			},
		},
		{
			type: "assistant",
			message:
			{
				role: "assistant",
				model: "<synthetic>",
			},
		},
		{
			type: "user",
			message:
			{
				role: "user",
				content: "no mode here",
			},
		},
	];

	it("finds the newest permission mode on a permission-mode or user record", () =>
	{
		expect(
			{
				all: lastPermissionModeFromRecords(records),
				modeRecordOnly: lastPermissionModeFromRecords(records.slice(0, 1)),
				none: lastPermissionModeFromRecords(records.slice(2)),
			},
		).toStrictEqual(
			{
				all: "acceptEdits",
				modeRecordOnly: "plan",
				none: null,
			},
		);
	});

	it("finds the newest assistant effort, preferring the turn's own over the session's", () =>
	{
		const turns = [
			{
				type: "assistant",
				effort: "high",
				perTurnEffort: "high",
				message:
				{
					role: "assistant",
					model: "claude-opus-5-5",
				},
			},
			{
				type: "assistant",
				effort: "medium",
				perTurnEffort: "max",
				message:
				{
					role: "assistant",
					model: "claude-opus-5-5",
				},
			},
			{
				type: "assistant",
				effort: "medium",
				perTurnEffort: null,
				message:
				{
					role: "assistant",
					model: "claude-opus-5-5",
				},
			},
			{
				type: "assistant",
				message:
				{
					role: "assistant",
					model: "<synthetic>",
				},
			},
			{
				type: "user",
				message:
				{
					role: "user",
					content: "next",
				},
			},
		];
		expect(
			{
				nullTurn: lastAssistantEffortFromRecords(turns),
				turnOverride: lastAssistantEffortFromRecords(turns.slice(0, 2)),
				none: lastAssistantEffortFromRecords(records),
			},
		).toStrictEqual(
			{
				nullTurn: "medium",
				turnOverride: "max",
				none: null,
			},
		);
	});

	it("finds the newest real assistant model, skipping synthetic records", () =>
	{
		expect(
			{
				all: lastAssistantModelFromRecords(records),
				none: lastAssistantModelFromRecords(records.slice(0, 2)),
			},
		).toStrictEqual(
			{
				all: "claude-opus-4-8",
				none: null,
			},
		);
	});
});

describe("usage ring", () =>
{
	it.each([
		{
			percent: null,
			expected: USAGE_RING_CIRCUMFERENCE,
		},
		{
			percent: 0,
			expected: USAGE_RING_CIRCUMFERENCE,
		},
		{
			percent: 19,
			expected: 0.81 * USAGE_RING_CIRCUMFERENCE,
		},
		{
			percent: 100,
			expected: 0,
		},
		{
			percent: 140,
			expected: 0,
		},
		{
			percent: -5,
			expected: USAGE_RING_CIRCUMFERENCE,
		},
	])("dashoffset for $percent%", ({percent, expected}) =>
	{
		expect(usageRingDashoffset(percent)).toBeCloseTo(expected, 6);
	});

	it("uses the upstream circumference for an r=6 circle", () =>
	{
		expect(USAGE_RING_CIRCUMFERENCE).toBe(37.699);
	});

	it("shows the most-used plan limit, not the context window", () =>
	{
		expect(
			{
				both: usageRingPercent(
					{
						fiveHour:
						{
							usedPercentage: 22,
						},
						weekly:
						{
							usedPercentage: 73,
						},
					},
				),
				sessionHigher: usageRingPercent(
					{
						fiveHour:
						{
							usedPercentage: 81,
						},
						weekly:
						{
							usedPercentage: 40,
						},
					},
				),
				weeklyOnly: usageRingPercent(
					{
						fiveHour: null,
						weekly:
						{
							usedPercentage: 12,
						},
					},
				),
				none: usageRingPercent(
					{
						fiveHour: null,
						weekly: null,
					},
				),
				empty: usageRingPercent(null),
			},
		).toStrictEqual(
			{
				both: 73,
				sessionHigher: 81,
				weeklyOnly: 12,
				none: null,
				empty: null,
			},
		);
	});

	it.each([
		{
			percent: null,
			expected: "normal",
		},
		{
			percent: 74,
			expected: "normal",
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
			expected: "critical",
		},
		{
			percent: 100,
			expected: "critical",
		},
	] as const)("severity for $percent% is $expected", ({percent, expected}) =>
	{
		expect(usageRingSeverity(percent)).toBe(expected);
	});

	it("builds the upstream aria-label from the most-used limit", () =>
	{
		const usage = resolveComposerState(
			{
				...EMPTY_SOURCES,
				statusline: ALICE_STATUSLINE,
			},
		).usage;
		expect(
			{
				alice: formatUsageAriaLabel(usage, NOW_MS),
				days: formatUsageAriaLabel(
					{
						contextTokens: 4_000,
						contextWindowSize: 200_000,
						contextPercent: 2,
						fiveHour:
						{
							usedPercentage: 22,
							resetsAt: NOW_SEC + 3600,
						},
						weekly:
						{
							usedPercentage: 73,
							resetsAt: NOW_SEC + 2 * 86_400 + 3 * 3600,
						},
						updatedAt: null,
					},
					NOW_MS,
					"UTC",
				),
			},
		).toStrictEqual(
			{
				alice: "Usage: Weekly · all models: 65%, Resets in 14 hr 31 min",
				days: "Usage: Weekly · all models: 73%, Resets Thu 3:00 PM",
			},
		);
	});

	it("labels the five-hour limit when it is the most used, the context window with no limits, else bare Usage", () =>
	{
		const fiveHourOnly = StatuslineSchema.parse(
			{
				context_window:
				{
					context_window_size: 200_000,
					used_percentage: 2,
				},
				rate_limits:
				{
					five_hour:
					{
						used_percentage: 7.4,
						resets_at: NOW_SEC + 30 * 60,
					},
				},
			},
		);
		const usage = resolveComposerState(
			{
				...EMPTY_SOURCES,
				statusline: fiveHourOnly,
			},
		).usage;
		const contextOnly = resolveComposerState(
			{
				...EMPTY_SOURCES,
				statusline: StatuslineSchema.parse(
					{
						context_window:
						{
							context_window_size: 200_000,
							used_percentage: 2,
						},
					},
				),
			},
		).usage;
		expect(
			{
				fiveHour: formatUsageAriaLabel(usage, NOW_MS),
				contextOnly: formatUsageAriaLabel(contextOnly, NOW_MS),
				empty: formatUsageAriaLabel(null, NOW_MS),
			},
		).toStrictEqual(
			{
				fiveHour: "Usage: Session limit: 7%, Resets in 30 min",
				contextOnly: "Usage: Context 4k / 200k (2%)",
				empty: "Usage",
			},
		);
	});
});

describe("formatUsageTooltipRows", () =>
{
	it("puts the most-used limit on one row and its reset on the next, else a bare Usage row", () =>
	{
		const base =
		{
			contextTokens: 604_700,
			contextWindowSize: 1_000_000,
			contextPercent: 60,
			updatedAt: null,
		};
		expect(
			{
				weekly: formatUsageTooltipRows(
					{
						...base,
						fiveHour:
						{
							usedPercentage: 22,
							resetsAt: NOW_SEC + 3600,
						},
						weekly:
						{
							usedPercentage: 73,
							resetsAt: NOW_SEC + 2 * 86_400 + 3 * 3600,
						},
					},
					NOW_MS,
					"UTC",
				),
				fiveHour: formatUsageTooltipRows(
					{
						...base,
						fiveHour:
						{
							usedPercentage: 7.4,
							resetsAt: NOW_SEC + 30 * 60,
						},
						weekly:
						{
							usedPercentage: 3,
							resetsAt: NOW_SEC + 2 * 86_400,
						},
					},
					NOW_MS,
				),
				contextOnly: formatUsageTooltipRows(
					{
						...base,
						fiveHour: null,
						weekly: null,
					},
					NOW_MS,
				),
				empty: formatUsageTooltipRows(null, NOW_MS),
			},
		).toStrictEqual(
			{
				weekly: ["Weekly · all models: 73%", "Resets Thu 3:00 PM"],
				fiveHour: ["Session limit: 7%", "Resets in 30 min"],
				contextOnly: ["Context 604.7k / 1M (60%)"],
				empty: ["Usage"],
			},
		);
	});
});

describe("usage ring context mode", () =>
{
	const contextOnly =
	{
		contextTokens: 656_200,
		contextWindowSize: 1_000_000,
		contextPercent: 66,
		fiveHour: null,
		weekly: null,
		updatedAt: null,
	};

	it("is context mode only without plan windows and with context tokens (upstream `Kn` → none)", () =>
	{
		expect(
			{
				contextOnly: usageRingMode(contextOnly),
				weekly: usageRingMode(
					{
						...contextOnly,
						weekly:
						{
							usedPercentage: 12,
							resetsAt: NOW_SEC + 86_400,
						},
					},
				),
				noTokens: usageRingMode(
					{
						...contextOnly,
						contextTokens: null,
					},
				),
				empty: usageRingMode(null),
			},
		).toStrictEqual(
			{
				contextOnly: "context",
				weekly: "plan",
				noTokens: "plan",
				empty: "plan",
			},
		);
	});

	it("summarises the window as upstream's `ru(..., withPct)`", () =>
	{
		expect([
			formatContextRingSummary(656_200, 1_000_000),
			formatContextRingSummary(1_200_000, 1_000_000),
			formatContextRingSummary(5000, null),
			contextRingPercent(contextOnly),
			contextRingPercent(
				{
					...contextOnly,
					contextTokens: 1_200_000,
				},
			),
			contextRingPercent(
				{
					...contextOnly,
					contextWindowSize: null,
				},
			),
		]).toStrictEqual(["656.2k / 1M (66%)", "1.2M", "5k", 66, null, null]);
	});

	it("labels the ring by its context summary", () =>
	{
		expect(
			{
				aria: formatUsageAriaLabel(contextOnly, NOW_MS),
				tooltip: formatUsageTooltipRows(contextOnly, NOW_MS),
			},
		).toStrictEqual(
			{
				aria: "Usage: Context 656.2k / 1M (66%)",
				tooltip: ["Context 656.2k / 1M (66%)"],
			},
		);
	});
});

describe("formatResetLabel", () =>
{
	it.each([
		{
			name: "minutes away",
			resetsAt: NOW_SEC + 30 * 60,
			expected: "Resets in 30 min",
		},
		{
			name: "hours away",
			resetsAt: NOW_SEC + 4 * 3600 + 11 * 60,
			expected: "Resets in 4 hr 11 min",
		},
		{
			name: "just under a day",
			resetsAt: NOW_SEC + 23 * 3600 + 59 * 60,
			expected: "Resets in 23 hr 59 min",
		},
		{
			name: "exactly a day",
			resetsAt: NOW_SEC + 86_400,
			expected: "Resets Wed 12:00 PM",
		},
		{
			name: "days away",
			resetsAt: NOW_SEC + 5 * 86_400 + 16 * 3600,
			expected: "Resets Mon 4:00 AM",
		},
		{
			name: "already passed",
			resetsAt: NOW_SEC - 60,
			expected: "Resets in 0 min",
		},
	])("$name", ({resetsAt, expected}) =>
	{
		expect(formatResetLabel(resetsAt, NOW_MS, "UTC")).toBe(expected);
	});
});

describe("StatuslineSchema rate_limits", () =>
{
	it("accepts the captured rate limit windows", () =>
	{
		expect(StatuslineSchema.parse(ALICE_STATUSLINE).rate_limits).toStrictEqual(
			{
				five_hour:
				{
					used_percentage: 10,
					resets_at: NOW_SEC + 4 * 3600 + 11 * 60,
				},
				seven_day:
				{
					used_percentage: 65,
					resets_at: NOW_SEC + 14 * 3600 + 31 * 60,
				},
			},
		);
	});

	it("keeps unknown keys inside rate_limits at runtime", () =>
	{
		expect(
			StatuslineSchema.parse(
				{
					rate_limits:
					{
						five_hour:
						{
							used_percentage: 1,
							resets_at: 1,
							extra: true,
						},
						monthly:
						{
							used_percentage: 2,
							resets_at: 3,
						},
					},
				},
			).rate_limits,
		).toStrictEqual(
			{
				five_hour:
				{
					used_percentage: 1,
					resets_at: 1,
					extra: true,
				},
				monthly:
				{
					used_percentage: 2,
					resets_at: 3,
				},
			},
		);
	});

	it("rejects unknown keys inside rate_limits in the strict schema", () =>
	{
		expect(
			StatuslineRateLimitsStrictSchema.safeParse(
				{
					five_hour:
					{
						used_percentage: 1,
						resets_at: 1,
						extra: true,
					},
				},
			).success,
		).toBe(false);
		expect(
			StatuslineRateLimitsStrictSchema.safeParse(
				{
					monthly: {},
				},
			).success,
		).toBe(false);
		expect(
			StatuslineRateLimitsStrictSchema.safeParse(
				{
					spend_limit:
					{
						used_percentage: 12,
						resets_at: 1_794_300_000,
						used_usd: 3.5,
						limit_usd: 50,
						extra: 1,
					},
				},
			).success,
		).toBe(false);
	});

	it("accepts every known window in the strict schema", () =>
	{
		const rateLimits =
		{
			five_hour:
			{
				used_percentage: 1,
				resets_at: 1,
			},
			seven_day:
			{
				used_percentage: 2,
				resets_at: 2,
			},
			spend_limit:
			{
				used_percentage: 12,
				resets_at: 1_794_300_000,
				used_usd: 3.5,
				limit_usd: 50,
				period: "monthly",
			},
		};
		expect(StatuslineRateLimitsStrictSchema.parse(rateLimits)).toStrictEqual(rateLimits);
	});
});

describe("getComposerState", () =>
{
	it("reads settings and the statusline with its mtime", async () =>
	{
		const readStatusline = vi.fn<ComposerStateDependencies["readStatusline"]>(async () =>
			Promise.resolve(
				{
					json: ALICE_STATUSLINE,
					mtimeMs: Date.parse("2026-09-29T09:00:00.000Z"),
				},
			),
		);
		const readSettings = vi.fn<ComposerStateDependencies["readSettings"]>(async () =>
			Promise.resolve(
				{
					model: "fable",
					effortLevel: "xhigh",
					advisorModel: "opus",
					permissions:
					{
						defaultMode: "auto",
					},
				},
			),
		);

		expect(
			await getComposerState(
				"alice-session",
				{
					readStatusline,
					readSettings,
				},
			),
		).toStrictEqual(
			{
				settingsDefaultMode: "auto",
				settingsDefaultModeManaged: false,
				settingsModel: "fable",
				settingsModelManaged: false,
				settingsAvailableModels: null,
				settingsEffortLevel: "xhigh",
				settingsBypassPermissionsAllowed: false,
				settingsFastMode: false,
				settingsAdvisorModel: "opus",
				fastModeBlocked: null,
				statusline: ALICE_STATUSLINE,
				statuslineUpdatedAt: "2026-09-29T09:00:00.000Z",
			},
		);
		expect(readStatusline.mock.calls).toStrictEqual([["alice-session"]]);
	});

	it("keeps the statusline when rate_limits gains a key the schema does not know", async () =>
	{
		const json =
		{
			...ALICE_STATUSLINE,
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
				seven_day_fable:
				{
					used_percentage: 5,
					resets_at: 1_794_297_600,
				},
			},
		};
		const result = await getComposerState(
			"erin-session",
			{
				readStatusline: async () =>
					Promise.resolve(
						{
							json,
							mtimeMs: Date.parse("2026-09-29T09:00:00.000Z"),
						},
					),
				readSettings: async () => Promise.resolve({}),
			},
		);
		expect(
			{
				statusline: result.statusline,
				statuslineUpdatedAt: result.statuslineUpdatedAt,
			},
		).toStrictEqual(
			{
				statusline: json,
				statuslineUpdatedAt: "2026-09-29T09:00:00.000Z",
			},
		);
	});

	it("reads availableModels with its source, a managed file winning over user settings, and a managed model", async () =>
	{
		const read = async (user: unknown, managed?: unknown) =>
		{
			const state = await getComposerState(
				"dave-session",
				{
					readStatusline: async () => Promise.reject(new Error("ENOENT: fabricated")),
					readSettings: async () => Promise.resolve(user),
					...(managed === undefined
						? {}
						:
							{
								readManagedSettings: async () => Promise.resolve(managed),
								managedSettingsPath: "/Library/Application Support/ClaudeCode/managed-settings.json",
							}),
				},
			);
			return {
				model: state.settingsModel,
				managed: state.settingsModelManaged,
				availableModels: state.settingsAvailableModels,
			};
		};

		expect(
			{
				user: await read(
					{
						model: "opus",
						availableModels: ["opus", "claude-sonnet-5-5"],
					},
				),
				managed: await read(
					{
						model: "opus",
						availableModels: ["opus"],
					},
					{
						model: "sonnet",
						availableModels: ["sonnet"],
					},
				),
				absent: await read({}),
				notArray: await read(
					{
						model: "fable",
						availableModels: "opus",
					},
				),
			},
		).toStrictEqual(
			{
				user:
				{
					model: "opus",
					managed: false,
					availableModels:
					{
						value: ["opus", "claude-sonnet-5-5"],
						source: "user",
						path: "~/.claude/settings.json",
					},
				},
				managed:
				{
					model: "sonnet",
					managed: true,
					availableModels:
					{
						value: ["sonnet"],
						source: "managed",
						path: "/Library/Application Support/ClaudeCode/managed-settings.json",
					},
				},
				absent:
				{
					model: null,
					managed: false,
					availableModels: null,
				},
				notArray:
				{
					model: "fable",
					managed: false,
					availableModels: null,
				},
			},
		);
	});

	it("reads permissions.defaultMode managed first, with its managed flag, for sessions and the home bar", async () =>
	{
		const read = async (user: unknown, managed?: unknown) =>
		{
			const dependencies =
				managed === undefined
					? {}
					:
						{
							readManagedSettings: async () => Promise.resolve(managed),
							managedSettingsPath: "/etc/claude-code/managed-settings.json",
						};
			const state = await getComposerState(
				"erin-session",
				{
					readStatusline: async () => Promise.reject(new Error("ENOENT: fabricated")),
					readSettings: async () => Promise.resolve(user),
					...dependencies,
				},
			);
			const defaults = await getComposerDefaults(async () => Promise.resolve(user), dependencies);
			return {
				session: [state.settingsDefaultMode, state.settingsDefaultModeManaged],
				home: [defaults.defaultMode, defaults.defaultModeManaged],
			};
		};

		const userAuto =
		{
			permissions:
			{
				defaultMode: "auto",
			},
		};
		expect(
			{
				managed: await read(
					userAuto,
					{
						permissions:
						{
							defaultMode: "acceptEdits",
						},
					},
				),
				managedWithoutMode: await read(
					userAuto,
					{
						model: "sonnet",
					},
				),
				noUserFile: await read(
					undefined,
					{
						permissions:
						{
							defaultMode: "plan",
						},
					},
				),
				user: await read(userAuto),
			},
		).toStrictEqual(
			{
				managed:
				{
					session: ["acceptEdits", true],
					home: ["acceptEdits", true],
				},
				managedWithoutMode:
				{
					session: ["auto", false],
					home: ["auto", false],
				},
				noUserFile:
				{
					session: ["plan", true],
					home: ["plan", true],
				},
				user:
				{
					session: ["auto", false],
					home: ["auto", false],
				},
			},
		);
	});

	it("gives the home bar's defaults the same availableModels and managed model", async () =>
	{
		const defaults = await getComposerDefaults(
			async () =>
				Promise.resolve(
					{
						availableModels: ["opus"],
					},
				),
			{
				readManagedSettings: async () =>
					Promise.resolve(
						{
							model: "haiku",
						},
					),
				managedSettingsPath: "/etc/claude-code/managed-settings.json",
			},
		);
		expect(
			{
				model: defaults.model,
				modelManaged: defaults.modelManaged,
				availableModels: defaults.availableModels,
			},
		).toStrictEqual(
			{
				model: "haiku",
				modelManaged: true,
				availableModels:
				{
					value: ["opus"],
					source: "user",
					path: "~/.claude/settings.json",
				},
			},
		);
	});

	it("returns nulls when files are missing or invalid", async () =>
	{
		const result = await getComposerState(
			"bob-session",
			{
				readStatusline: async () => Promise.reject(new Error("ENOENT: fabricated")),
				readSettings: async () =>
					Promise.resolve(
						{
							permissions:
							{
								defaultMode: 42,
							},
						},
					),
			},
		);
		expect(result).toStrictEqual(
			{
				settingsDefaultMode: null,
				settingsDefaultModeManaged: false,
				settingsModel: null,
				settingsModelManaged: false,
				settingsAvailableModels: null,
				settingsEffortLevel: null,
				settingsBypassPermissionsAllowed: false,
				settingsFastMode: false,
				settingsAdvisorModel: null,
				fastModeBlocked: null,
				statusline: null,
				statuslineUpdatedAt: null,
			},
		);
	});

	it("allows Bypass permissions when settings skip its warning or default to it", async () =>
	{
		const allowed = async (settings: unknown) =>
			(
				await getComposerState(
					"carol-session",
					{
						readStatusline: async () => Promise.reject(new Error("ENOENT: fabricated")),
						readSettings: async () => Promise.resolve(settings),
					},
				)
			).settingsBypassPermissionsAllowed;

		expect(
			{
				skip: await allowed(
					{
						skipDangerousModePermissionPrompt: true,
					},
				),
				defaultMode: await allowed(
					{
						permissions:
						{
							defaultMode: "bypassPermissions",
						},
					},
				),
				neither: await allowed(
					{
						permissions:
						{
							defaultMode: "auto",
						},
					},
				),
			},
		).toStrictEqual(
			{
				skip: true,
				defaultMode: true,
				neither: false,
			},
		);
	});

	it("starts a fresh session in fast mode when settings turn it on without a per-session opt-in", async () =>
	{
		const fast = async (settings: unknown) =>
			(
				await getComposerState(
					"dave-session",
					{
						readStatusline: async () => Promise.reject(new Error("ENOENT: fabricated")),
						readSettings: async () => Promise.resolve(settings),
					},
				)
			).settingsFastMode;

		expect(
			{
				on: await fast(
					{
						fastMode: true,
					},
				),
				optIn: await fast(
					{
						fastMode: true,
						fastModePerSessionOptIn: true,
					},
				),
				off: await fast({}),
			},
		).toStrictEqual(
			{
				on: true,
				optIn: false,
				off: false,
			},
		);
	});

	it("blocks fast mode from the settings env merged over the server env, or a managed policy", async () =>
	{
		const blocked = async (dependencies: Partial<ComposerStateDependencies>) =>
			(
				await getComposerState(
					"erin-session",
					{
						readStatusline: async () => Promise.reject(new Error("ENOENT: fabricated")),
						readSettings: async () => Promise.resolve({}),
						...dependencies,
					},
				)
			).fastModeBlocked;

		expect(
			{
				settingsEnv: await blocked(
					{
						readSettings: async () =>
							Promise.resolve(
								{
									env:
									{
										CLAUDE_CODE_DISABLE_FAST_MODE: "1",
									},
								},
							),
					},
				),
				serverEnv: await blocked(
					{
						env:
						{
							CLAUDE_CODE_USE_VERTEX: "1",
						},
					},
				),
				settingsOverride: await blocked(
					{
						env:
						{
							CLAUDE_CODE_DISABLE_FAST_MODE: "1",
						},
						readSettings: async () =>
							Promise.resolve(
								{
									env:
									{
										CLAUDE_CODE_DISABLE_FAST_MODE: "0",
									},
								},
							),
					},
				),
				policy: await blocked(
					{
						readManagedSettings: async () =>
							Promise.resolve(
								{
									fastMode: false,
								},
							),
					},
				),
				missingPolicy: await blocked(
					{
						readManagedSettings: async () => Promise.reject(new Error("ENOENT")),
					},
				),
			},
		).toStrictEqual(
			{
				settingsEnv:
				{
					code: "disabled_by_env",
					line: "Off for this session",
					reason: "An environment variable turns fast mode off in this session.",
				},
				serverEnv:
				{
					code: "not_first_party",
					line: "Not available with this provider",
					reason: "Fast mode is only available when Claude Code uses the Claude API directly.",
				},
				settingsOverride: null,
				policy:
				{
					code: "preference",
					line: "Not available",
				},
				missingPolicy: null,
			},
		);
	});

	it("never reads a statusline for a traversal session id", async () =>
	{
		const readStatusline = vi.fn<ComposerStateDependencies["readStatusline"]>(async () =>
			Promise.resolve(
				{
					json: {},
					mtimeMs: 0,
				},
			),
		);
		const response = await handleComposerStateRequest(
			"../../etc/passwd",
			{
				readStatusline,
				readSettings: async () => Promise.resolve({}),
			},
		);
		expect(
			{
				body: await response.json(),
				reads: readStatusline.mock.calls,
				cacheControl: response.headers.get("Cache-Control"),
			},
		).toStrictEqual(
			{
				body:
				{
					settingsDefaultMode: null,
					settingsDefaultModeManaged: false,
					settingsModel: null,
					settingsModelManaged: false,
					settingsAvailableModels: null,
					settingsEffortLevel: null,
					settingsBypassPermissionsAllowed: false,
					settingsFastMode: false,
					settingsAdvisorModel: null,
					fastModeBlocked: null,
					statusline: null,
					statuslineUpdatedAt: null,
				},
				reads: [],
				cacheControl: "private, max-age=0, must-revalidate",
			},
		);
	});
});

describe("managedSettingsPath", () =>
{
	it("is where the CLI reads managed (policy) settings on each platform", () =>
	{
		expect([
			managedSettingsPath("darwin"),
			managedSettingsPath("linux"),
			managedSettingsPath("win32"),
		]).toStrictEqual([
			"/Library/Application Support/ClaudeCode/managed-settings.json",
			"/etc/claude-code/managed-settings.json",
			"C:\\Program Files\\ClaudeCode\\managed-settings.json",
		]);
	});
});

describe("withAccountLimits", () =>
{
	const summary =
	{
		fiveHour:
		{
			usedPct: 22,
			resetsAt: NOW_SEC + 3600,
		},
		sevenDay:
		{
			usedPct: 50,
			resetsAt: NOW_SEC + 3 * 86_400,
		},
		updatedAt: "2026-09-29T08:00:00.000Z",
		scoped: null,
	};

	it("fills a chin with no usage from the account limits, so the home ring shows Weekly 50%", () =>
	{
		const usage = withAccountLimits(null, summary);

		expect(
			{
				usage,
				percent: usageRingPercent(usage),
				offset: usageRingDashoffset(usageRingPercent(usage)),
			},
		).toStrictEqual(
			{
				usage:
				{
					contextTokens: null,
					contextWindowSize: null,
					contextPercent: null,
					fiveHour:
					{
						usedPercentage: 22,
						resetsAt: NOW_SEC + 3600,
					},
					weekly:
					{
						usedPercentage: 50,
						resetsAt: NOW_SEC + 3 * 86_400,
					},
					updatedAt: "2026-09-29T08:00:00.000Z",
				},
				percent: 50,
				offset: usageRingDashoffset(50),
			},
		);
	});

	it("keeps a session's context usage and adds limits only when the statusline has none", () =>
	{
		const contextOnly =
		{
			contextTokens: 4_000,
			contextWindowSize: 200_000,
			contextPercent: 2,
			fiveHour: null,
			weekly: null,
			updatedAt: "2026-09-29T09:00:00.000Z",
		};
		const withLimits =
		{
			...contextOnly,
			weekly:
			{
				usedPercentage: 9,
				resetsAt: NOW_SEC,
			},
		};

		expect(
			{
				filled: withAccountLimits(contextOnly, summary),
				kept: withAccountLimits(withLimits, summary),
				noSummary: withAccountLimits(contextOnly, undefined),
			},
		).toStrictEqual(
			{
				filled:
				{
					...contextOnly,
					fiveHour:
					{
						usedPercentage: 22,
						resetsAt: NOW_SEC + 3600,
					},
					weekly:
					{
						usedPercentage: 50,
						resetsAt: NOW_SEC + 3 * 86_400,
					},
				},
				kept: withLimits,
				noSummary: contextOnly,
			},
		);
	});

	const scopedSummary = (fablePercent: number, resetsAt: string | null) => (
	{
		...summary,
		fiveHour: null,
		sevenDay:
		{
			usedPct: 46,
			resetsAt: NOW_SEC + 3 * 86_400,
		},
		scoped:
		{
			limits: [
				{
					kind: "weekly_all",
					group: "weekly",
					percent: 46,
					severity: "normal",
					resets_at: new Date((NOW_SEC + 3 * 86_400) * 1000).toISOString(),
					scope: null,
					is_active: true,
				},
				{
					kind: "weekly_scoped",
					group: "weekly",
					percent: fablePercent,
					severity: "normal",
					resets_at: resetsAt,
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
			],
			shares: [],
			fetchedAt: "2026-09-29T07:00:00.000Z",
		},
	});

	function ring(modelId: string, fablePercent: number, resetsAt: string | null = null)
	{
		const usage = withAccountLimits(null, scopedSummary(fablePercent, resetsAt), modelId);
		return {
			scoped: usage?.scoped?.map((meter) => meter.label) ?? [],
			percent: usageRingPercent(usage),
			aria: formatUsageAriaLabel(usage, NOW_MS, "UTC"),
		};
	}

	it("adds the model family's cached rows to the ring, hiding another family's", () =>
	{
		const reset = new Date((NOW_SEC + 2 * 86_400) * 1000).toISOString();
		expect(
			{
				opus: ring("claude-opus-5-5", 0),
				fableUnused: ring("claude-fable-1", 0),
				fableHigher: ring("claude-fable-1", 80, reset),
				opusHigherFable: ring("claude-opus-5-5", 80, reset),
				fableNoReset: ring("claude-fable-1", 80),
			},
		).toStrictEqual(
			{
				opus:
				{
					scoped: [],
					percent: 46,
					aria: "Usage: Weekly · all models: 46%, Resets Fri 12:00 PM",
				},
				fableUnused:
				{
					scoped: ["Weekly · Fable"],
					percent: 46,
					aria: "Usage: Weekly · all models: 46%, Resets Fri 12:00 PM",
				},
				fableHigher:
				{
					scoped: ["Weekly · Fable"],
					percent: 80,
					aria: "Usage: Weekly · Fable: 80%, Resets Thu 12:00 PM",
				},
				opusHigherFable:
				{
					scoped: [],
					percent: 46,
					aria: "Usage: Weekly · all models: 46%, Resets Fri 12:00 PM",
				},
				fableNoReset:
				{
					scoped: ["Weekly · Fable"],
					percent: 80,
					aria: "Usage: Weekly · Fable: 80%, You haven’t used Fable yet",
				},
			},
		);
	});

	it("takes the family from the composer state's model", () =>
	{
		const state = resolveComposerState(
			{
				hookPermissionMode: null,
				jsonlPermissionMode: null,
				settingsDefaultMode: null,
				statuslineModel: null,
				statuslineModelId: "claude-fable-1",
				lastAssistantModel: null,
				lastAssistantUsage: null,
				lastAssistantEffort: null,
				fastMode: false,
				fastModeBlocked: null,
				settingsModel: null,
				settingsModelManaged: false,
				settingsAvailableModels: null,
				settingsEffortLevel: null,
				statusline: null,
				statuslineUpdatedAt: null,
			},
		);

		expect(
			withComposerAccountLimits(state, scopedSummary(5, null)).usage?.scoped?.map((meter) => meter.label),
		).toStrictEqual(["Weekly · Fable"]);
	});
});

describe("composer defaults for a project folder", () =>
{
	const USER_SETTINGS =
	{
		permissions: {},
	};

	function projectFiles(files: Record<string, unknown>)
	{
		return async (file: "settings.local.json" | "settings.json") =>
			file in files ? Promise.resolve(files[file]) : Promise.reject(new Error("ENOENT"));
	}

	it("reads the project's defaultMode, with settings.local.json beating settings.json", async () =>
	{
		const [shared, local, none] = await Promise.all([
			getComposerDefaults(
				async () => Promise.resolve(USER_SETTINGS),
				{},
				projectFiles(
					{
						"settings.json":
						{
							permissions:
							{
								defaultMode: "plan",
							},
						},
					},
				),
			),
			getComposerDefaults(
				async () => Promise.resolve(USER_SETTINGS),
				{},
				projectFiles(
					{
						"settings.json":
						{
							permissions:
							{
								defaultMode: "plan",
							},
						},
						"settings.local.json":
						{
							permissions:
							{
								defaultMode: "acceptEdits",
							},
						},
					},
				),
			),
			getComposerDefaults(async () => Promise.resolve(USER_SETTINGS), {}, projectFiles({})),
		]);
		expect([shared, local, none]).toStrictEqual([
			{
				model: null,
				effortLevel: null,
				defaultMode: null,
				defaultModeManaged: false,
				repoDefaultMode: "plan",
				modelManaged: false,
				availableModels: null,
				bypassPermissionsAllowed: false,
				fastMode: false,
				fastModeBlocked: null,
				cliFallbackMode: "auto",
			},
			{
				model: null,
				effortLevel: null,
				defaultMode: null,
				defaultModeManaged: false,
				repoDefaultMode: "acceptEdits",
				modelManaged: false,
				availableModels: null,
				bypassPermissionsAllowed: false,
				fastMode: false,
				fastModeBlocked: null,
				cliFallbackMode: "auto",
			},
			{
				model: null,
				effortLevel: null,
				defaultMode: null,
				defaultModeManaged: false,
				repoDefaultMode: null,
				modelManaged: false,
				availableModels: null,
				bypassPermissionsAllowed: false,
				fastMode: false,
				fastModeBlocked: null,
				cliFallbackMode: "auto",
			},
		]);
	});

	it("serves the CLI's no-flag fallback mode: auto unless the rollout gate, disableAutoMode or remote turns it off", async () =>
	{
		const disabled =
		{
			permissions:
			{
				disableAutoMode: "disable",
			},
		};
		const fallback = async ({
			user = USER_SETTINGS,
			managed,
			project = {},
			config = null,
			env = {},
		}: {
			user?: unknown;
			managed?: unknown;
			project?: Record<string, unknown>;
			config?: Record<string, unknown> | null;
			env?: Record<string, string>;
		}) =>
			(
				await getComposerDefaults(
					async () => Promise.resolve(user),
					{
						env,
						readCliConfig: async () => Promise.resolve(config),
						...(managed === undefined
							? {}
							:
								{
									readManagedSettings: async () => Promise.resolve(managed),
								}),
					},
					projectFiles(project),
				)
			).cliFallbackMode;

		expect(
			{
				noConfig: await fallback({}),
				gateOn: await fallback(
					{
						config:
						{
							cachedGrowthBookFeatures:
							{
								tengu_harbor_willow: true,
							},
						},
					},
				),
				gateOff: await fallback(
					{
						config:
						{
							cachedGrowthBookFeatures:
							{
								tengu_harbor_willow: false,
							},
						},
					},
				),
				userDisabled: await fallback(
					{
						user: disabled,
					},
				),
				userTopLevelDisabled: await fallback(
					{
						user:
						{
							disableAutoMode: "disable",
						},
					},
				),
				managedDisabled: await fallback(
					{
						managed: disabled,
					},
				),
				projectLocalDisabled: await fallback(
					{
						project:
						{
							"settings.local.json": disabled,
						},
					},
				),
				remote: await fallback(
					{
						env:
						{
							CLAUDE_CODE_REMOTE: "1",
						},
					},
				),
				remoteFalse: await fallback(
					{
						env:
						{
							CLAUDE_CODE_REMOTE: "0",
						},
					},
				),
			},
		).toStrictEqual(
			{
				noConfig: "auto",
				gateOn: "auto",
				gateOff: "default",
				userDisabled: "default",
				userTopLevelDisabled: "default",
				managedDisabled: "default",
				projectLocalDisabled: "default",
				remote: "default",
				remoteFalse: "auto",
			},
		);
	});

	it("serves ?cwd= only for a known project folder", async () =>
	{
		const reads: string[] = [];
		const dependencies: ComposerDefaultsRequestDependencies =
		{
			readSettings: async () => Promise.resolve(USER_SETTINGS),
			blockDependencies: {},
			readJson: async (path) =>
			{
				reads.push(path);
				return path === "/w/app/.claude/settings.json"
					? Promise.resolve(
							{
								permissions:
								{
									defaultMode: "plan",
								},
							},
						)
					: Promise.reject(new Error("ENOENT"));
			},
			knownProjectPaths: async () => Promise.resolve(["/w/app"]),
		};
		const responses = await Promise.all(
			[
				"http://x/api/composer-defaults?cwd=%2Fw%2Fapp",
				"http://x/api/composer-defaults?cwd=%2Fw%2Fother",
				"http://x/api/composer-defaults?cwd=w%2Fapp",
				"http://x/api/composer-defaults",
			].map(async (url) =>
			{
				const response = await handleComposerDefaultsRequest(new Request(url), dependencies);
				return {
					status: response.status,
					body: (await response.json()) as unknown,
				};
			}),
		);
		expect(
			{
				responses,
				reads: reads.toSorted(),
			},
		).toStrictEqual(
			{
				responses: [
					{
						status: 200,
						body:
						{
							model: null,
							effortLevel: null,
							defaultMode: null,
							defaultModeManaged: false,
							repoDefaultMode: "plan",
							modelManaged: false,
							availableModels: null,
							bypassPermissionsAllowed: false,
							fastMode: false,
							fastModeBlocked: null,
							cliFallbackMode: "auto",
						},
					},
					{
						status: 400,
						body:
						{
							error: "Expected ?cwd=<a known project folder>",
						},
					},
					{
						status: 400,
						body:
						{
							error: "Expected ?cwd=<a known project folder>",
						},
					},
					{
						status: 200,
						body:
						{
							model: null,
							effortLevel: null,
							defaultMode: null,
							defaultModeManaged: false,
							repoDefaultMode: null,
							modelManaged: false,
							availableModels: null,
							bypassPermissionsAllowed: false,
							fastMode: false,
							fastModeBlocked: null,
							cliFallbackMode: "auto",
						},
					},
				],
				reads: ["/w/app/.claude/settings.json", "/w/app/.claude/settings.local.json"],
			},
		);
	});

	it("lets a remembered folder mode beat the project default", () =>
	{
		expect(
			resolveDraftBaseMode(
				{
					userChoice: null,
					userSettingsDefault: undefined,
					folderChoice: "acceptEdits",
					repoSettingsDefault: "plan",
					fallback: "default",
				},
			).mode,
		).toBe("acceptEdits");
	});
});
