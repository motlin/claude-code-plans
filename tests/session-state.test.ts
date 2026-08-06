import { describe, expect, it } from "vite-plus/test";

import { KNOWN_HOOK_EVENTS } from "../src/lib/hook-events";
import type { HookEvent } from "../src/lib/hook-events";
import { stateForEvent, type ActivityState, type DisplayState } from "../src/lib/session-state";

const ACTIVITY_STATES = ["idle", "working", "waiting", "unknown"] satisfies ActivityState[];
const DISPLAY_STATES = [...ACTIVITY_STATES, "review"] satisfies DisplayState[];

const BASE_EVENT = {
  session_id: "session-test-100",
  transcript_path: "/tmp/test/session-test-100.jsonl",
  cwd: "/tmp/test/project",
} as const;

interface StateCase {
  name: string;
  event: HookEvent;
  expected: ActivityState | null;
}

const STATE_CASES = [
  {
    name: "SessionStart carries no state",
    event: { ...BASE_EVENT, hook_event_name: "SessionStart", source: "startup" },
    expected: null,
  },
  {
    name: "SessionEnd is idle",
    event: { ...BASE_EVENT, hook_event_name: "SessionEnd" },
    expected: "idle",
  },
  {
    name: "Stop is idle",
    event: { ...BASE_EVENT, hook_event_name: "Stop" },
    expected: "idle",
  },
  {
    name: "SubagentStart carries no state",
    event: { ...BASE_EVENT, hook_event_name: "SubagentStart" },
    expected: null,
  },
  {
    name: "SubagentStop carries no state",
    event: { ...BASE_EVENT, hook_event_name: "SubagentStop" },
    expected: null,
  },
  {
    name: "UserPromptSubmit is working",
    event: { ...BASE_EVENT, hook_event_name: "UserPromptSubmit", prompt: "Test prompt" },
    expected: "working",
  },
  {
    name: "Notification carries no state",
    event: { ...BASE_EVENT, hook_event_name: "Notification", message: "Test notification" },
    expected: null,
  },
  {
    name: "manual PreCompact is working",
    event: { ...BASE_EVENT, hook_event_name: "PreCompact", trigger: "manual" },
    expected: "working",
  },
  {
    name: "automatic PreCompact carries no state",
    event: { ...BASE_EVENT, hook_event_name: "PreCompact", trigger: "auto" },
    expected: null,
  },
  {
    name: "PreCompact without trigger carries no state",
    event: { ...BASE_EVENT, hook_event_name: "PreCompact" },
    expected: null,
  },
  {
    name: "manual PostCompact is idle",
    event: { ...BASE_EVENT, hook_event_name: "PostCompact", reason: "manual" },
    expected: "idle",
  },
  {
    name: "automatic PostCompact carries no state",
    event: { ...BASE_EVENT, hook_event_name: "PostCompact", reason: "auto" },
    expected: null,
  },
  {
    name: "PostCompact without reason carries no state",
    event: { ...BASE_EVENT, hook_event_name: "PostCompact" },
    expected: null,
  },
  {
    name: "AskUserQuestion PreToolUse is waiting",
    event: {
      ...BASE_EVENT,
      hook_event_name: "PreToolUse",
      tool_name: "AskUserQuestion",
      tool_input: { question: "Test question?" },
    },
    expected: "waiting",
  },
  {
    name: "ExitPlanMode PreToolUse is waiting",
    event: {
      ...BASE_EVENT,
      hook_event_name: "PreToolUse",
      tool_name: "ExitPlanMode",
      tool_input: { plan: "Test plan" },
    },
    expected: "waiting",
  },
  {
    name: "other PreToolUse is working",
    event: {
      ...BASE_EVENT,
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "true" },
    },
    expected: "working",
  },
  {
    name: "PostToolUse is working",
    event: {
      ...BASE_EVENT,
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "true" },
    },
    expected: "working",
  },
  {
    name: "PostToolUseFailure is working",
    event: {
      ...BASE_EVENT,
      hook_event_name: "PostToolUseFailure",
      tool_name: "Bash",
      tool_input: { command: "false" },
      error: "Test failure",
    },
    expected: "working",
  },
  {
    name: "TaskCreated carries no state",
    event: { ...BASE_EVENT, hook_event_name: "TaskCreated" },
    expected: null,
  },
  {
    name: "TaskCompleted carries no state",
    event: { ...BASE_EVENT, hook_event_name: "TaskCompleted" },
    expected: null,
  },
  {
    name: "WorktreeCreate carries no state",
    event: { ...BASE_EVENT, hook_event_name: "WorktreeCreate" },
    expected: null,
  },
  {
    name: "WorktreeRemove carries no state",
    event: { ...BASE_EVENT, hook_event_name: "WorktreeRemove" },
    expected: null,
  },
  {
    name: "CwdChanged carries no state",
    event: {
      ...BASE_EVENT,
      hook_event_name: "CwdChanged",
      old_cwd: "/tmp/test/old-project",
      new_cwd: "/tmp/test/new-project",
    },
    expected: null,
  },
  {
    name: "InstructionsLoaded carries no state",
    event: {
      ...BASE_EVENT,
      hook_event_name: "InstructionsLoaded",
      file_path: "/tmp/test/project/CLAUDE.md",
    },
    expected: null,
  },
  {
    name: "ConfigChange carries no state",
    event: {
      ...BASE_EVENT,
      hook_event_name: "ConfigChange",
      config_source: "project_settings",
    },
    expected: null,
  },
  {
    name: "MessageDisplay is working",
    event: { ...BASE_EVENT, hook_event_name: "MessageDisplay", message: "Test response" },
    expected: "working",
  },
] satisfies StateCase[];

describe("stateForEvent", () => {
  it("exports the activity and display state contracts", () => {
    expect({ activity: ACTIVITY_STATES, display: DISPLAY_STATES }).toStrictEqual({
      activity: ["idle", "working", "waiting", "unknown"],
      display: ["idle", "working", "waiting", "unknown", "review"],
    });
  });

  it("covers every known hook event", () => {
    expect(new Set(STATE_CASES.map(({ event }) => event.hook_event_name))).toStrictEqual(
      new Set(KNOWN_HOOK_EVENTS),
    );
  });

  it.each(STATE_CASES)("maps $name", ({ event, expected }) => {
    expect(stateForEvent(event)).toBe(expected);
  });
});
