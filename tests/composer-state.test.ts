import { describe, expect, it, vi } from "vite-plus/test";
import { StatuslineSchema, type Statusline } from "../src/lib/api/statusline";
import {
  type ComposerStateSources,
  formatUsageAriaLabel,
  getComposerState,
  lastAssistantModelFromRecords,
  lastPermissionModeFromRecords,
  resolveComposerState,
  USAGE_RING_CIRCUMFERENCE,
  usageRingDashoffset,
} from "../src/lib/composer-state";
import { handleComposerStateRequest } from "../src/routes/api/sessions.$id.composer-state";

const NOW_MS = Date.UTC(2026, 8, 29, 12, 0, 0);
const NOW_SEC = NOW_MS / 1000;

const ALICE_STATUSLINE: Statusline = StatuslineSchema.parse({
  model: { id: "claude-opus-5-5", display_name: "Opus 5.5" },
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
    five_hour: { used_percentage: 10, resets_at: NOW_SEC + 4 * 3600 + 11 * 60 },
    seven_day: { used_percentage: 65, resets_at: NOW_SEC + 14 * 3600 + 31 * 60 },
  },
});

const EMPTY_SOURCES: ComposerStateSources = {
  hookPermissionMode: null,
  jsonlPermissionMode: null,
  settingsDefaultMode: null,
  statuslineModel: null,
  lastAssistantModel: null,
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
      expected: { id: "plan", label: "Plan" },
    },
    {
      hook: null,
      jsonl: "acceptEdits",
      settings: "auto",
      expected: { id: "acceptEdits", label: "Accept edits" },
    },
    { hook: "", jsonl: "default", settings: "auto", expected: { id: "default", label: "Manual" } },
    { hook: null, jsonl: null, settings: "auto", expected: { id: "auto", label: "Auto" } },
    {
      hook: "bypassPermissions",
      jsonl: null,
      settings: null,
      expected: { id: "bypassPermissions", label: "Bypass permissions" },
    },
    {
      hook: "dontAsk",
      jsonl: null,
      settings: null,
      expected: { id: "dontAsk", label: "Don't ask" },
    },
    { hook: null, jsonl: null, settings: null, expected: null },
  ])("mode: hook=$hook jsonl=$jsonl settings=$settings", ({ hook, jsonl, settings, expected }) => {
    const state = resolveComposerState({
      ...EMPTY_SOURCES,
      hookPermissionMode: hook,
      jsonlPermissionMode: jsonl,
      settingsDefaultMode: settings,
    });
    expect(state.mode).toStrictEqual(expected);
  });

  it.each([
    { statusline: "Opus 5.5", assistant: "claude-sonnet-4-6", expected: "Opus 5.5" },
    { statusline: null, assistant: "claude-sonnet-4-6", expected: "Sonnet 4.6" },
    { statusline: null, assistant: "claude-haiku-4-5-20251001", expected: "Haiku 4.5" },
    { statusline: null, assistant: null, expected: null },
  ])(
    "model: statusline=$statusline assistant=$assistant",
    ({ statusline, assistant, expected }) => {
      const state = resolveComposerState({
        ...EMPTY_SOURCES,
        statuslineModel: statusline,
        lastAssistantModel: assistant,
      });
      expect(state.model).toStrictEqual(expected);
    },
  );

  it.each([
    { settings: "low", expected: { id: "low", label: "Low" } },
    { settings: "medium", expected: { id: "medium", label: "Medium" } },
    { settings: "xhigh", expected: { id: "xhigh", label: "Extra-high" } },
    { settings: "max", expected: { id: "max", label: "Max" } },
    { settings: null, expected: { id: "high", label: "High" } },
  ])("effort: settings=$settings", ({ settings, expected }) => {
    const state = resolveComposerState({ ...EMPTY_SOURCES, settingsEffortLevel: settings });
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
      fiveHour: { usedPercentage: 10, resetsAt: NOW_SEC + 4 * 3600 + 11 * 60 },
      weekly: { usedPercentage: 65, resetsAt: NOW_SEC + 14 * 3600 + 31 * 60 },
      updatedAt: "2026-09-29T09:00:00.000Z",
    });
  });

  it("usage is null without a statusline", () => {
    expect(resolveComposerState(EMPTY_SOURCES).usage).toBeNull();
  });
});

describe("transcript record extraction", () => {
  const records = [
    { type: "permission-mode", permissionMode: "plan", sessionId: "alice" },
    { type: "user", permissionMode: "acceptEdits", message: { role: "user", content: "hi" } },
    { type: "assistant", message: { role: "assistant", model: "claude-opus-4-8" } },
    { type: "assistant", message: { role: "assistant", model: "<synthetic>" } },
    { type: "user", message: { role: "user", content: "no mode here" } },
  ];

  it("finds the newest permission mode on a permission-mode or user record", () => {
    expect({
      all: lastPermissionModeFromRecords(records),
      modeRecordOnly: lastPermissionModeFromRecords(records.slice(0, 1)),
      none: lastPermissionModeFromRecords(records.slice(2)),
    }).toStrictEqual({ all: "acceptEdits", modeRecordOnly: "plan", none: null });
  });

  it("finds the newest real assistant model, skipping synthetic records", () => {
    expect({
      all: lastAssistantModelFromRecords(records),
      none: lastAssistantModelFromRecords(records.slice(0, 2)),
    }).toStrictEqual({ all: "claude-opus-4-8", none: null });
  });
});

describe("usage ring", () => {
  it.each([
    { percent: null, expected: USAGE_RING_CIRCUMFERENCE },
    { percent: 0, expected: USAGE_RING_CIRCUMFERENCE },
    { percent: 19, expected: 0.81 * USAGE_RING_CIRCUMFERENCE },
    { percent: 100, expected: 0 },
    { percent: 140, expected: 0 },
    { percent: -5, expected: USAGE_RING_CIRCUMFERENCE },
  ])("dashoffset for $percent%", ({ percent, expected }) => {
    expect(usageRingDashoffset(percent)).toBeCloseTo(expected, 6);
  });

  it("uses the upstream circumference for an r=5 circle", () => {
    expect(USAGE_RING_CIRCUMFERENCE).toBe(31.4159);
  });

  it("builds the upstream aria-label from context and the weekly limit", () => {
    const usage = resolveComposerState({ ...EMPTY_SOURCES, statusline: ALICE_STATUSLINE }).usage;
    expect(formatUsageAriaLabel(usage, NOW_MS)).toBe(
      "Usage: Context 190.2k / 1M (19%), Weekly · all models: 65%, Resets in 14 hr 31 min",
    );
  });

  it("falls back to the five-hour limit, then to a bare context label", () => {
    const fiveHourOnly = StatuslineSchema.parse({
      context_window: { context_window_size: 200_000, used_percentage: 2 },
      rate_limits: { five_hour: { used_percentage: 7.4, resets_at: NOW_SEC + 30 * 60 } },
    });
    const usage = resolveComposerState({ ...EMPTY_SOURCES, statusline: fiveHourOnly }).usage;
    expect({
      fiveHour: formatUsageAriaLabel(usage, NOW_MS),
      empty: formatUsageAriaLabel(null, NOW_MS),
      days: formatUsageAriaLabel(
        {
          contextTokens: 4_000,
          contextWindowSize: 200_000,
          contextPercent: 2,
          fiveHour: null,
          weekly: { usedPercentage: 11, resetsAt: NOW_SEC + 2 * 86_400 + 3 * 3600 },
          updatedAt: null,
        },
        NOW_MS,
      ),
    }).toStrictEqual({
      fiveHour: "Usage: Context 4k / 200k (2%), 5-hour limit: 7%, Resets in 30 min",
      empty: "Usage: Context 0",
      days: "Usage: Context 4k / 200k (2%), Weekly · all models: 11%, Resets in 2 days 3 hr",
    });
  });
});

describe("StatuslineSchema rate_limits", () => {
  it("accepts the captured rate limit windows", () => {
    expect(StatuslineSchema.parse(ALICE_STATUSLINE).rate_limits).toStrictEqual({
      five_hour: { used_percentage: 10, resets_at: NOW_SEC + 4 * 3600 + 11 * 60 },
      seven_day: { used_percentage: 65, resets_at: NOW_SEC + 14 * 3600 + 31 * 60 },
    });
  });

  it("rejects unknown keys inside rate_limits", () => {
    expect(
      StatuslineSchema.safeParse({
        rate_limits: { five_hour: { used_percentage: 1, resets_at: 1, extra: true } },
      }).success,
    ).toBe(false);
    expect(StatuslineSchema.safeParse({ rate_limits: { monthly: {} } }).success).toBe(false);
  });
});

describe("getComposerState", () => {
  it("reads settings and the statusline with its mtime", async () => {
    const readStatusline = vi.fn(async () => ({
      json: ALICE_STATUSLINE as unknown,
      mtimeMs: Date.parse("2026-09-29T09:00:00.000Z"),
    }));
    const readSettings = vi.fn(async () => ({
      effortLevel: "xhigh",
      permissions: { defaultMode: "auto" },
    }));

    expect(await getComposerState("alice-session", { readStatusline, readSettings })).toStrictEqual(
      {
        settingsDefaultMode: "auto",
        settingsEffortLevel: "xhigh",
        settingsBypassPermissionsAllowed: false,
        statusline: ALICE_STATUSLINE,
        statuslineUpdatedAt: "2026-09-29T09:00:00.000Z",
      },
    );
    expect(readStatusline.mock.calls).toStrictEqual([["alice-session"]]);
  });

  it("returns nulls when files are missing or invalid", async () => {
    const result = await getComposerState("bob-session", {
      readStatusline: async () => {
        throw new Error("ENOENT: fabricated");
      },
      readSettings: async () => ({ permissions: { defaultMode: 42 } }),
    });
    expect(result).toStrictEqual({
      settingsDefaultMode: null,
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
      skip: await allowed({ skipDangerousModePermissionPrompt: true }),
      defaultMode: await allowed({ permissions: { defaultMode: "bypassPermissions" } }),
      neither: await allowed({ permissions: { defaultMode: "auto" } }),
    }).toStrictEqual({ skip: true, defaultMode: true, neither: false });
  });

  it("never reads a statusline for a traversal session id", async () => {
    const readStatusline = vi.fn(async () => ({ json: {} as unknown, mtimeMs: 0 }));
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
