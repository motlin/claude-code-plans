import {describe, expect, it, vi} from "vite-plus/test";
import {StatuslineSchema, type Statusline} from "../src/lib/api/statusline";
import {
	type ComposerStateSources,
	formatResetLabel,
	formatUsageAriaLabel,
	formatUsageTooltipRows,
	getComposerState,
	lastAssistantModelFromRecords,
	lastAssistantUsageFromRecords,
	lastPermissionModeFromRecords,
	resolveComposerState,
	USAGE_RING_CIRCUMFERENCE,
	usageRingDashoffset,
} from "../src/lib/composer-state";
import {handleComposerStateRequest} from "../src/routes/api/sessions.$id.composer-state";

const NOW_MS = Date.UTC(2026, 8, 29, 12, 0, 0);
const NOW_SEC = NOW_MS / 1000;

const ALICE_STATUSLINE: Statusline = StatuslineSchema.parse({
	model: {id: "claude-opus-5-5", display_name: "Opus 5.5"},
	context_window: {
		total_input_tokens: 190_200,
		total_output_tokens: 157,
		context_window_size: 1_000_000,
		current_usage: {
			input_tokens: 200,
			output_tokens: 157,
			cache_creation_input_tokens: 1_000,
			cache_read_input_tokens: 189_000,
		},
		used_percentage: 19,
		remaining_percentage: 81,
	},
	rate_limits: {
		five_hour: {used_percentage: 10, resets_at: NOW_SEC + 4 * 3600 + 11 * 60},
		seven_day: {used_percentage: 65, resets_at: NOW_SEC + 14 * 3600 + 31 * 60},
	},
});

const EMPTY_SOURCES: ComposerStateSources = {
	hookPermissionMode: null,
	jsonlPermissionMode: null,
	settingsDefaultMode: null,
	statuslineModel: null,
	statuslineModelId: null,
	lastAssistantModel: null,
	lastAssistantUsage: null,
	settingsModel: null,
	settingsEffortLevel: null,
	statusline: null,
	statuslineUpdatedAt: null,
};

describe("resolveComposerState precedence", () => {
	it.each([
		{
			hook: "plan",
			jsonl: "acceptEdits",
			settings: "auto",
			expected: {id: "plan", label: "Plan"},
		},
		{
			hook: null,
			jsonl: "acceptEdits",
			settings: "auto",
			expected: {id: "acceptEdits", label: "Accept edits"},
		},
		{hook: "", jsonl: "default", settings: "auto", expected: {id: "default", label: "Manual"}},
		{hook: null, jsonl: null, settings: "auto", expected: {id: "auto", label: "Auto"}},
		{
			hook: "bypassPermissions",
			jsonl: null,
			settings: null,
			expected: {id: "bypassPermissions", label: "Bypass permissions"},
		},
		{
			hook: "dontAsk",
			jsonl: null,
			settings: null,
			expected: {id: "dontAsk", label: "Don't ask"},
		},
		{hook: null, jsonl: null, settings: null, expected: null},
	])("mode: hook=$hook jsonl=$jsonl settings=$settings", ({hook, jsonl, settings, expected}) => {
		const state = resolveComposerState({
			...EMPTY_SOURCES,
			hookPermissionMode: hook,
			jsonlPermissionMode: jsonl,
			settingsDefaultMode: settings,
		});
		expect(state.mode).toStrictEqual(expected);
	});

	it.each([
		{
			statusline: {id: "claude-opus-5-5", name: "Opus 5.5"},
			assistant: "claude-sonnet-4-6",
			settings: "haiku",
			expected: {model: "Opus 5.5", modelId: "claude-opus-5-5"},
		},
		{
			statusline: null,
			assistant: "claude-sonnet-4-6",
			settings: "haiku",
			expected: {model: "Sonnet 4.6", modelId: "claude-sonnet-4-6"},
		},
		{
			statusline: null,
			assistant: "claude-haiku-4-5-20251001",
			settings: null,
			expected: {model: "Haiku 4.5", modelId: "claude-haiku-4-5-20251001"},
		},
		{
			statusline: null,
			assistant: null,
			settings: "fable",
			expected: {model: "Fable 5.1", modelId: "claude-fable-5-1"},
		},
		{
			statusline: null,
			assistant: null,
			settings: "claude-opus-4-8[1m]",
			expected: {model: "Opus 4.8", modelId: "claude-opus-4-8[1m]"},
		},
		{statusline: null, assistant: null, settings: null, expected: {model: "Opus 5.5", modelId: "claude-opus-5-5"}},
	])(
		"model: statusline=$statusline.id assistant=$assistant settings=$settings",
		({statusline, assistant, settings, expected}) => {
			const state = resolveComposerState({
				...EMPTY_SOURCES,
				statuslineModel: statusline?.name ?? null,
				statuslineModelId: statusline?.id ?? null,
				lastAssistantModel: assistant,
				settingsModel: settings,
			});
			expect({model: state.model, modelId: state.modelId}).toStrictEqual(expected);
		},
	);

	it.each([
		{settings: "low", expected: {id: "low", label: "Low"}},
		{settings: "medium", expected: {id: "medium", label: "Medium"}},
		{settings: "xhigh", expected: {id: "xhigh", label: "Extra-high"}},
		{settings: "max", expected: {id: "max", label: "Max"}},
		{settings: null, expected: {id: "high", label: "High"}},
	])("effort: settings=$settings", ({settings, expected}) => {
		const state = resolveComposerState({...EMPTY_SOURCES, settingsEffortLevel: settings});
		expect(state.effort).toStrictEqual(expected);
	});

	it("usage comes from the statusline context window and rate limits", () => {
		const state = resolveComposerState({
			...EMPTY_SOURCES,
			statusline: ALICE_STATUSLINE,
			statuslineUpdatedAt: "2026-09-29T09:00:00.000Z",
		});
		expect(state.usage).toStrictEqual({
			contextTokens: 190_200,
			contextWindowSize: 1_000_000,
			contextPercent: 19,
			fiveHour: {usedPercentage: 10, resetsAt: NOW_SEC + 4 * 3600 + 11 * 60},
			weekly: {usedPercentage: 65, resetsAt: NOW_SEC + 14 * 3600 + 31 * 60},
			updatedAt: "2026-09-29T09:00:00.000Z",
		});
	});

	it("usage is null without a statusline or transcript usage", () => {
		expect(resolveComposerState(EMPTY_SOURCES).usage).toBeNull();
	});

	const assistantRecord = (model: string, timestamp: string, usage: Record<string, number>) => ({
		type: "assistant",
		timestamp,
		message: {role: "assistant", model, usage},
	});
	const CACHED_USAGE = {
		input_tokens: 4,
		cache_creation_input_tokens: 2_996,
		cache_read_input_tokens: 47_000,
		output_tokens: 900,
	};

	it.each([
		{
			name: "no assistant record",
			records: [{type: "user", message: {role: "user", content: "hi"}}],
			expected: null,
		},
		{
			name: "assistant with cache tokens on a 200k model",
			records: [
				assistantRecord("claude-haiku-4-5-20251001", "2026-09-29T08:00:00.000Z", {
					input_tokens: 1,
					output_tokens: 1,
				}),
				assistantRecord("claude-haiku-4-5-20251001", "2026-09-29T08:30:00.000Z", CACHED_USAGE),
				{type: "assistant", timestamp: "2026-09-29T08:31:00.000Z", message: {model: "<synthetic>", usage: {}}},
				{type: "user", timestamp: "2026-09-29T08:32:00.000Z", message: {role: "user", content: "next"}},
			],
			expected: {
				contextTokens: 50_000,
				contextWindowSize: 200_000,
				contextPercent: 25,
				fiveHour: null,
				weekly: null,
				updatedAt: "2026-09-29T08:30:00.000Z",
			},
		},
		{
			name: "1M model",
			records: [assistantRecord("claude-opus-5-5", "2026-09-29T07:00:00.000Z", CACHED_USAGE)],
			expected: {
				contextTokens: 50_000,
				contextWindowSize: 1_000_000,
				contextPercent: 5,
				fiveHour: null,
				weekly: null,
				updatedAt: "2026-09-29T07:00:00.000Z",
			},
		},
		{
			name: "[1m] suffix",
			records: [assistantRecord("claude-sonnet-4-6[1m]", "2026-09-29T07:00:00.000Z", CACHED_USAGE)],
			expected: {
				contextTokens: 50_000,
				contextWindowSize: 1_000_000,
				contextPercent: 5,
				fiveHour: null,
				weekly: null,
				updatedAt: "2026-09-29T07:00:00.000Z",
			},
		},
	])("usage falls back to the transcript: $name", ({records, expected}) => {
		const state = resolveComposerState({
			...EMPTY_SOURCES,
			lastAssistantModel: lastAssistantModelFromRecords(records),
			lastAssistantUsage: lastAssistantUsageFromRecords(records),
		});
		expect(state.usage).toStrictEqual(expected);
	});

	it("the statusline wins over transcript usage", () => {
		const state = resolveComposerState({
			...EMPTY_SOURCES,
			lastAssistantModel: "claude-haiku-4-5-20251001",
			lastAssistantUsage: {contextTokens: 50_000, timestamp: "2026-09-29T08:30:00.000Z"},
			statusline: ALICE_STATUSLINE,
			statuslineUpdatedAt: "2026-09-29T09:00:00.000Z",
		});
		expect(state.usage).toStrictEqual({
			contextTokens: 190_200,
			contextWindowSize: 1_000_000,
			contextPercent: 19,
			fiveHour: {usedPercentage: 10, resetsAt: NOW_SEC + 4 * 3600 + 11 * 60},
			weekly: {usedPercentage: 65, resetsAt: NOW_SEC + 14 * 3600 + 31 * 60},
			updatedAt: "2026-09-29T09:00:00.000Z",
		});
	});
});

describe("transcript record extraction", () => {
	const records = [
		{type: "permission-mode", permissionMode: "plan", sessionId: "alice"},
		{type: "user", permissionMode: "acceptEdits", message: {role: "user", content: "hi"}},
		{type: "assistant", message: {role: "assistant", model: "claude-opus-4-8"}},
		{type: "assistant", message: {role: "assistant", model: "<synthetic>"}},
		{type: "user", message: {role: "user", content: "no mode here"}},
	];

	it("finds the newest permission mode on a permission-mode or user record", () => {
		expect({
			all: lastPermissionModeFromRecords(records),
			modeRecordOnly: lastPermissionModeFromRecords(records.slice(0, 1)),
			none: lastPermissionModeFromRecords(records.slice(2)),
		}).toStrictEqual({all: "acceptEdits", modeRecordOnly: "plan", none: null});
	});

	it("finds the newest real assistant model, skipping synthetic records", () => {
		expect({
			all: lastAssistantModelFromRecords(records),
			none: lastAssistantModelFromRecords(records.slice(0, 2)),
		}).toStrictEqual({all: "claude-opus-4-8", none: null});
	});
});

describe("usage ring", () => {
	it.each([
		{percent: null, expected: USAGE_RING_CIRCUMFERENCE},
		{percent: 0, expected: USAGE_RING_CIRCUMFERENCE},
		{percent: 19, expected: 0.81 * USAGE_RING_CIRCUMFERENCE},
		{percent: 100, expected: 0},
		{percent: 140, expected: 0},
		{percent: -5, expected: USAGE_RING_CIRCUMFERENCE},
	])("dashoffset for $percent%", ({percent, expected}) => {
		expect(usageRingDashoffset(percent)).toBeCloseTo(expected, 6);
	});

	it("uses the upstream circumference for an r=5 circle", () => {
		expect(USAGE_RING_CIRCUMFERENCE).toBe(31.4159);
	});

	it("builds the upstream aria-label from context and the weekly limit", () => {
		const usage = resolveComposerState({...EMPTY_SOURCES, statusline: ALICE_STATUSLINE}).usage;
		expect(formatUsageAriaLabel(usage, NOW_MS)).toBe(
			"Usage: Context 190.2k / 1M (19%), Weekly · all models: 65%, Resets in 14 hr 31 min",
		);
	});

	it("falls back to the five-hour limit, then to a bare context label", () => {
		const fiveHourOnly = StatuslineSchema.parse({
			context_window: {context_window_size: 200_000, used_percentage: 2},
			rate_limits: {five_hour: {used_percentage: 7.4, resets_at: NOW_SEC + 30 * 60}},
		});
		const usage = resolveComposerState({...EMPTY_SOURCES, statusline: fiveHourOnly}).usage;
		expect({
			fiveHour: formatUsageAriaLabel(usage, NOW_MS),
			empty: formatUsageAriaLabel(null, NOW_MS),
			days: formatUsageAriaLabel(
				{
					contextTokens: 4_000,
					contextWindowSize: 200_000,
					contextPercent: 2,
					fiveHour: null,
					weekly: {usedPercentage: 11, resetsAt: NOW_SEC + 2 * 86_400 + 3 * 3600},
					updatedAt: null,
				},
				NOW_MS,
				"UTC",
			),
		}).toStrictEqual({
			fiveHour: "Usage: Context 4k / 200k (2%), 5-hour limit: 7%, Resets in 30 min",
			empty: "Usage: Context 0",
			days: "Usage: Context 4k / 200k (2%), Weekly · all models: 11%, Resets Thu 3:00 PM",
		});
	});
});

describe("formatUsageTooltipRows", () => {
	it("pairs the context summary with the weekly limit, else the five-hour limit, else context alone", () => {
		const base = {contextTokens: 604_700, contextWindowSize: 1_000_000, contextPercent: 60, updatedAt: null};
		expect({
			weekly: formatUsageTooltipRows(
				{
					...base,
					fiveHour: {usedPercentage: 10, resetsAt: NOW_SEC + 3600},
					weekly: {usedPercentage: 38.2, resetsAt: NOW_SEC + 2 * 86_400 + 3 * 3600},
				},
				NOW_MS,
				"UTC",
			),
			fiveHour: formatUsageTooltipRows(
				{...base, fiveHour: {usedPercentage: 7.4, resetsAt: NOW_SEC + 30 * 60}, weekly: null},
				NOW_MS,
			),
			contextOnly: formatUsageTooltipRows({...base, fiveHour: null, weekly: null}, NOW_MS),
			empty: formatUsageTooltipRows(null, NOW_MS),
		}).toStrictEqual({
			weekly: ["Context 604.7k / 1M (60%)", "Weekly · all models: 38% · Resets Thu 3:00 PM"],
			fiveHour: ["Context 604.7k / 1M (60%)", "5-hour limit: 7% · Resets in 30 min"],
			contextOnly: ["Context 604.7k / 1M (60%)"],
			empty: ["Context 0"],
		});
	});
});

describe("formatResetLabel", () => {
	it.each([
		{name: "minutes away", resetsAt: NOW_SEC + 30 * 60, expected: "Resets in 30 min"},
		{name: "hours away", resetsAt: NOW_SEC + 4 * 3600 + 11 * 60, expected: "Resets in 4 hr 11 min"},
		{name: "just under a day", resetsAt: NOW_SEC + 23 * 3600 + 59 * 60, expected: "Resets in 23 hr 59 min"},
		{name: "exactly a day", resetsAt: NOW_SEC + 86_400, expected: "Resets Wed 12:00 PM"},
		{name: "days away", resetsAt: NOW_SEC + 5 * 86_400 + 16 * 3600, expected: "Resets Mon 4:00 AM"},
		{name: "already passed", resetsAt: NOW_SEC - 60, expected: "Resets in 0 min"},
	])("$name", ({resetsAt, expected}) => {
		expect(formatResetLabel(resetsAt, NOW_MS, "UTC")).toBe(expected);
	});
});

describe("StatuslineSchema rate_limits", () => {
	it("accepts the captured rate limit windows", () => {
		expect(StatuslineSchema.parse(ALICE_STATUSLINE).rate_limits).toStrictEqual({
			five_hour: {used_percentage: 10, resets_at: NOW_SEC + 4 * 3600 + 11 * 60},
			seven_day: {used_percentage: 65, resets_at: NOW_SEC + 14 * 3600 + 31 * 60},
		});
	});

	it("rejects unknown keys inside rate_limits", () => {
		expect(
			StatuslineSchema.safeParse({
				rate_limits: {five_hour: {used_percentage: 1, resets_at: 1, extra: true}},
			}).success,
		).toBe(false);
		expect(StatuslineSchema.safeParse({rate_limits: {monthly: {}}}).success).toBe(false);
	});
});

describe("getComposerState", () => {
	it("reads settings and the statusline with its mtime", async () => {
		const readStatusline = vi.fn(async () => ({
			json: ALICE_STATUSLINE as unknown,
			mtimeMs: Date.parse("2026-09-29T09:00:00.000Z"),
		}));
		const readSettings = vi.fn(async () => ({
			model: "fable",
			effortLevel: "xhigh",
			permissions: {defaultMode: "auto"},
		}));

		expect(await getComposerState("alice-session", {readStatusline, readSettings})).toStrictEqual({
			settingsDefaultMode: "auto",
			settingsModel: "fable",
			settingsEffortLevel: "xhigh",
			settingsBypassPermissionsAllowed: false,
			statusline: ALICE_STATUSLINE,
			statuslineUpdatedAt: "2026-09-29T09:00:00.000Z",
		});
		expect(readStatusline.mock.calls).toStrictEqual([["alice-session"]]);
	});

	it("returns nulls when files are missing or invalid", async () => {
		const result = await getComposerState("bob-session", {
			readStatusline: async () => {
				throw new Error("ENOENT: fabricated");
			},
			readSettings: async () => ({permissions: {defaultMode: 42}}),
		});
		expect(result).toStrictEqual({
			settingsDefaultMode: null,
			settingsModel: null,
			settingsEffortLevel: null,
			settingsBypassPermissionsAllowed: false,
			statusline: null,
			statuslineUpdatedAt: null,
		});
	});

	it("allows Bypass permissions when settings skip its warning or default to it", async () => {
		const allowed = async (settings: unknown) =>
			(
				await getComposerState("carol-session", {
					readStatusline: async () => {
						throw new Error("ENOENT: fabricated");
					},
					readSettings: async () => settings,
				})
			).settingsBypassPermissionsAllowed;

		expect({
			skip: await allowed({skipDangerousModePermissionPrompt: true}),
			defaultMode: await allowed({permissions: {defaultMode: "bypassPermissions"}}),
			neither: await allowed({permissions: {defaultMode: "auto"}}),
		}).toStrictEqual({skip: true, defaultMode: true, neither: false});
	});

	it("never reads a statusline for a traversal session id", async () => {
		const readStatusline = vi.fn(async () => ({json: {} as unknown, mtimeMs: 0}));
		const response = await handleComposerStateRequest("../../etc/passwd", {
			readStatusline,
			readSettings: async () => ({}),
		});
		expect({
			body: await response.json(),
			reads: readStatusline.mock.calls,
			cacheControl: response.headers.get("Cache-Control"),
		}).toStrictEqual({
			body: {
				settingsDefaultMode: null,
				settingsModel: null,
				settingsEffortLevel: null,
				settingsBypassPermissionsAllowed: false,
				statusline: null,
				statuslineUpdatedAt: null,
			},
			reads: [],
			cacheControl: "private, max-age=0, must-revalidate",
		});
	});
});
