import { describe, expect, it, vi } from "vite-plus/test";
import {
  SessionMetricsBatchResponse,
  StatuslineSchema,
  toSessionMetrics,
} from "../src/lib/api/statusline";
import { handleSessionStatuslineRequest } from "../src/routes/api/sessions.$id.statusline";
import { handleStatuslineBatchRequest } from "../src/routes/api/sessions.statusline";

// Captured Claude Code statusline shape with identifying values replaced.
const CAPTURED_STATUSLINE = {
  session_id: "session-100",
  transcript_path: "/tmp/test/project/session-100.jsonl",
  cwd: "/tmp/test/project",
  effort: { level: "high" },
  model: {
    id: "claude-test-model",
    display_name: "Claude Test Model",
  },
  workspace: {
    current_dir: "/tmp/test/project",
    project_dir: "/tmp/test/project",
    added_dirs: [],
  },
  version: "1.0.0-test",
  cost: {
    total_cost_usd: 2.5,
    total_duration_ms: 120_000,
    total_api_duration_ms: 60_000,
    total_lines_added: 100,
    total_lines_removed: 20,
    total_input_tokens: 10_000,
    total_output_tokens: 1_000,
  },
  context_window: {
    total_input_tokens: 10_000,
    total_output_tokens: 1_000,
    context_window_size: 200_000,
    used_percentage: 25,
    remaining_percentage: 75,
  },
  exceeds_200k_tokens: false,
};

const CAPTURED_STATUSLINE_WITH_NULL_CONTEXT = {
  ...CAPTURED_STATUSLINE,
  context_window: {
    total_input_tokens: 0,
    total_output_tokens: 0,
    context_window_size: 1_000_000,
    current_usage: null,
    used_percentage: null,
    remaining_percentage: null,
  },
};

describe("StatuslineSchema", () => {
  it("parses a captured statusline and maps its list metrics", () => {
    const statusline = StatuslineSchema.parse(CAPTURED_STATUSLINE);

    expect({ statusline, metrics: toSessionMetrics(statusline) }).toStrictEqual({
      statusline: CAPTURED_STATUSLINE,
      metrics: {
        model: "Claude Test Model",
        contextRemainingPct: 75,
        costUsd: 2.5,
        linesAdded: 100,
        linesRemoved: 20,
        elapsedMs: 120_000,
      },
    });
  });

  it("parses a captured statusline with null context percentages", () => {
    const statusline = StatuslineSchema.parse(CAPTURED_STATUSLINE_WITH_NULL_CONTEXT);

    expect({ statusline, metrics: toSessionMetrics(statusline) }).toStrictEqual({
      statusline: CAPTURED_STATUSLINE_WITH_NULL_CONTEXT,
      metrics: {
        model: "Claude Test Model",
        contextRemainingPct: null,
        costUsd: 2.5,
        linesAdded: 100,
        linesRemoved: 20,
        elapsedMs: 120_000,
      },
    });
  });

  it("preserves unknown fields from future Claude Code releases", () => {
    const statuslineWithUnknownFields = {
      ...CAPTURED_STATUSLINE,
      model: {
        ...CAPTURED_STATUSLINE.model,
        future_model_field: "alice",
      },
      future_status_field: {
        enabled: true,
      },
    };

    expect(StatuslineSchema.parse(statuslineWithUnknownFields)).toStrictEqual(
      statuslineWithUnknownFields,
    );
  });

  it("maps absent optional fields to null instead of zero", () => {
    expect(toSessionMetrics(StatuslineSchema.parse({}))).toStrictEqual({
      model: null,
      contextRemainingPct: null,
      costUsd: null,
      linesAdded: null,
      linesRemoved: null,
      elapsedMs: null,
    });
  });
});

describe("statusline batch API", () => {
  it("returns normalized metrics and null for missing files without reading invalid ids", async () => {
    const readStatusline = vi.fn(async (sessionId: string): Promise<unknown> => {
      if (sessionId === "alice-session") return CAPTURED_STATUSLINE;
      throw new Error("ENOENT: fabricated missing statusline");
    });
    const url = new URL("http://127.0.0.1:7526/api/sessions/statusline");
    url.searchParams.set("ids", "alice-session,bob-session,../not-a-session,alice-session");

    const response = await handleStatuslineBatchRequest(new Request(url), { readStatusline });
    const body: unknown = await response.json();

    expect({
      body,
      cacheControl: response.headers.get("Cache-Control"),
      readCalls: readStatusline.mock.calls,
      schemaResult: SessionMetricsBatchResponse.safeParse(body).success,
      status: response.status,
    }).toStrictEqual({
      body: {
        "alice-session": {
          model: "Claude Test Model",
          contextRemainingPct: 75,
          costUsd: 2.5,
          linesAdded: 100,
          linesRemoved: 20,
          elapsedMs: 120_000,
        },
        "bob-session": null,
      },
      cacheControl: "private, max-age=0, must-revalidate",
      readCalls: [["alice-session"], ["bob-session"]],
      schemaResult: true,
      status: 200,
    });
  });
});

describe("statusline session API", () => {
  it("returns null without reading files for a traversal session id", async () => {
    const fileContents = {
      name: "fabricated-package",
      private: true,
    };
    const readStatusline = vi.fn(async (): Promise<unknown> => fileContents);

    const response = await handleSessionStatuslineRequest(
      "../../../fixture/project/package/statusline",
      { readStatusline },
    );

    expect({
      body: await response.json(),
      cacheControl: response.headers.get("Cache-Control"),
      readCalls: readStatusline.mock.calls,
      status: response.status,
    }).toStrictEqual({
      body: null,
      cacheControl: "private, max-age=0, must-revalidate",
      readCalls: [],
      status: 200,
    });
  });
});
