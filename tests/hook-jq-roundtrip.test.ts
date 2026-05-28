/**
 * Round-trip test for verification step #1 of
 * `.llm/plans/2026-05-20-hooks-driven-live-updates.md`:
 *
 *   Take a literal copy of a real hook stdin payload Claude Code sends, pipe
 *   it through the exact `jq` command used in `src/lib/hook-config.ts` via
 *   `child_process`, then assert `HookEventEnvelope.safeParse(result).success
 *   === true` for each event variant.
 *
 * This is the only test that actually shells out to the real `jq` binary —
 * everything else parses synthetic JS objects. The point is to guarantee the
 * jq filter and the Zod schema agree on the wire format, so a Claude Code
 * payload change can't sneak past unit tests that bypass the shell.
 */
import { execFileSync, type SpawnSyncReturns } from "node:child_process";
import { describe, expect, it } from "vite-plus/test";
import { HOOK_PAYLOAD_JQ_FILTER } from "../src/lib/hook-config";
import { HookEventEnvelope, type HookEventName } from "../src/lib/hook-events";
import { postToolUseFailureFixture } from "./fixtures/post-tool-use-failure";
import { subagentStartFixture } from "./fixtures/subagent-start";

// CLAUDE-prefixed env Claude Code typically exposes to the hook subprocess.
// We pre-stage these via the `env` option to execFileSync so the jq filter's
// `$ENV` reflects what the real hook would see.
const HOOK_ENV: Record<string, string> = {
  PATH: process.env["PATH"] ?? "",
  CLAUDE_CODE_ENTRYPOINT: "cli",
  CLAUDE_CODE_EXECPATH: "/Users/u/.local/share/claude/versions/2.1.119",
  CLAUDECODE: "1",
  CLAUDE_PROJECT_DIR: "/Users/u/projects/app",
  // A non-CLAUDE-prefixed key — must NOT leak through the filter.
  HOME: "/Users/u",
};

function jqRoundTrip(stdinPayload: object): unknown {
  let result: SpawnSyncReturns<Buffer> | undefined;
  try {
    const stdout = execFileSync("jq", ["-c", HOOK_PAYLOAD_JQ_FILTER], {
      input: JSON.stringify(stdinPayload),
      env: HOOK_ENV,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return JSON.parse(stdout.toString("utf8")) as unknown;
  } catch (err) {
    result = err as SpawnSyncReturns<Buffer>;
    throw new Error(`jq failed: ${result.stderr?.toString("utf8") ?? String(err)}`);
  }
}

interface Case {
  name: HookEventName;
  payload: Record<string, unknown>;
}

const baseEnvelope = {
  session_id: "abc-123",
  transcript_path: "/Users/u/.claude/projects/-Users-u-projects-app/abc-123.jsonl",
  cwd: "/Users/u/projects/app",
};

const cases: Case[] = [
  {
    name: "SessionStart",
    payload: {
      ...baseEnvelope,
      hook_event_name: "SessionStart",
      source: "startup",
    },
  },
  {
    name: "SessionEnd",
    payload: {
      ...baseEnvelope,
      hook_event_name: "SessionEnd",
      reason: "logout",
    },
  },
  {
    name: "Stop",
    payload: {
      ...baseEnvelope,
      hook_event_name: "Stop",
      stop_hook_active: false,
    },
  },
  {
    name: "SubagentStart",
    payload: subagentStartFixture,
  },
  {
    name: "SubagentStop",
    payload: { ...baseEnvelope, hook_event_name: "SubagentStop" },
  },
  {
    name: "UserPromptSubmit",
    payload: {
      ...baseEnvelope,
      hook_event_name: "UserPromptSubmit",
      prompt: "fix the bug",
    },
  },
  {
    name: "Notification",
    payload: {
      ...baseEnvelope,
      hook_event_name: "Notification",
      message: "idle",
    },
  },
  {
    name: "PreCompact",
    payload: {
      ...baseEnvelope,
      hook_event_name: "PreCompact",
      trigger: "auto",
    },
  },
  {
    name: "PreToolUse",
    payload: {
      ...baseEnvelope,
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: "/etc/hosts" },
    },
  },
  {
    name: "PostToolUse",
    payload: {
      ...baseEnvelope,
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "ls" },
      tool_response: { stdout: "a.txt\nb.txt", stderr: "" },
    },
  },
  {
    name: "PostToolUseFailure",
    payload: postToolUseFailureFixture,
  },
  {
    name: "TaskCompleted",
    payload: {
      ...baseEnvelope,
      hook_event_name: "TaskCompleted",
      task_id: "t-1",
      task_subject: "Build auth",
    },
  },
  {
    name: "WorktreeCreate",
    payload: {
      ...baseEnvelope,
      hook_event_name: "WorktreeCreate",
      name: "wt-foo",
    },
  },
];

describe("hook stdin -> jq filter -> HookEventEnvelope round-trip", () => {
  for (const { name, payload } of cases) {
    it(`${name} payload survives the real jq filter and parses cleanly`, () => {
      const transformed = jqRoundTrip(payload);

      const parsed = HookEventEnvelope.safeParse(transformed);
      if (!parsed.success) {
        throw new Error(
          `HookEventEnvelope rejected jq output for ${name}: ${JSON.stringify(parsed.error.issues)}`,
        );
      }
      expect(parsed.success).toBe(true);
    });
  }

  it("attaches every CLAUDE-prefixed env var under claude_env", () => {
    const transformed = jqRoundTrip({
      ...baseEnvelope,
      hook_event_name: "Stop",
    }) as {
      claude_env?: Record<string, string>;
    };

    expect(transformed.claude_env).toStrictEqual({
      CLAUDE_CODE_ENTRYPOINT: "cli",
      CLAUDE_CODE_EXECPATH: "/Users/u/.local/share/claude/versions/2.1.119",
      CLAUDECODE: "1",
      CLAUDE_PROJECT_DIR: "/Users/u/projects/app",
    });
  });

  it("does not leak non-CLAUDE-prefixed env vars", () => {
    const transformed = jqRoundTrip({
      ...baseEnvelope,
      hook_event_name: "Stop",
    }) as {
      claude_env?: Record<string, string>;
    };

    expect(transformed.claude_env?.["HOME"]).toBeUndefined();
    expect(transformed.claude_env?.["PATH"]).toBeUndefined();
  });

  it("preserves all original stdin fields untouched", () => {
    const stdinPayload = {
      ...baseEnvelope,
      hook_event_name: "PostToolUse",
      tool_name: "Edit",
      tool_input: { file_path: "/tmp/x.ts", old_string: "a", new_string: "b" },
      tool_response: { filePath: "/tmp/x.ts", userModified: false },
    };
    const transformed = jqRoundTrip(stdinPayload) as Record<string, unknown>;

    for (const [key, value] of Object.entries(stdinPayload)) {
      expect(transformed[key]).toStrictEqual(value);
    }
  });
});
