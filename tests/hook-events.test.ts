import { describe, expect, it } from "vite-plus/test";
import {
  SSE_EVENTS,
  DOMAIN_EVENTS,
  HookEventEnvelope,
  diffEntityMaps,
} from "../src/lib/hook-events";

describe("HookEventEnvelope", () => {
  const baseEnvelope = {
    session_id: "abc123",
    transcript_path: "/Users/user/.claude/projects/-Users-user-project/abc123.jsonl",
    cwd: "/home/user/project",
  };

  it("parses SessionStart event", () => {
    const result = HookEventEnvelope.safeParse({
      ...baseEnvelope,
      hook_event_name: "SessionStart",
      model: "claude-sonnet-4-6",
      source: "startup",
    });
    expect(result.success).toBe(true);
  });

  it("parses SessionStart event with claude_env metadata", () => {
    const result = HookEventEnvelope.safeParse({
      ...baseEnvelope,
      hook_event_name: "SessionStart",
      source: "resume",
      claude_env: {
        CLAUDE_CODE_ENTRYPOINT: "cli",
        CLAUDE_CODE_EXECPATH: "/Users/user/.local/share/claude/versions/2.1.119",
        CLAUDECODE: "1",
        CLAUDE_EFFORT: "high",
        CLAUDE_CODE_TASK_LIST_ID: "my-project",
      },
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.hook_event_name === "SessionStart") {
      expect(result.data.claude_env?.["CLAUDE_CODE_ENTRYPOINT"]).toBe("cli");
      expect(result.data.claude_env?.["CLAUDE_EFFORT"]).toBe("high");
    }
  });

  it("requires source on SessionStart", () => {
    const result = HookEventEnvelope.safeParse({
      ...baseEnvelope,
      hook_event_name: "SessionStart",
    });
    expect(result.success).toBe(false);
  });

  it("parses PostToolUse event for Write tool", () => {
    const result = HookEventEnvelope.safeParse({
      ...baseEnvelope,
      hook_event_name: "PostToolUse",
      tool_name: "Write",
      tool_input: { file_path: "/tmp/test.ts", content: "hello" },
    });
    expect(result.success).toBe(true);
  });

  it("parses PostToolUse event for Bash tool with tool_response", () => {
    const result = HookEventEnvelope.safeParse({
      ...baseEnvelope,
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "ls" },
      tool_response: { stdout: "a.txt\nb.txt", stderr: "" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects PostToolUse with unknown tool_name", () => {
    const result = HookEventEnvelope.safeParse({
      ...baseEnvelope,
      hook_event_name: "PostToolUse",
      tool_name: "NotARealTool",
      tool_input: { anything: 1 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects PostToolUse with extra top-level fields", () => {
    const result = HookEventEnvelope.safeParse({
      ...baseEnvelope,
      hook_event_name: "PostToolUse",
      tool_name: "Write",
      tool_input: { file_path: "/tmp/test.ts", content: "hello" },
      brand_new_field: "surprise",
    });
    expect(result.success).toBe(false);
  });

  it("parses PreToolUse event", () => {
    const result = HookEventEnvelope.safeParse({
      ...baseEnvelope,
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: "/etc/hosts" },
    });
    expect(result.success).toBe(true);
  });

  it("parses PostToolUseFailure event with error and hook_specific_output", () => {
    const result = HookEventEnvelope.safeParse({
      ...baseEnvelope,
      hook_event_name: "PostToolUseFailure",
      tool_name: "Bash",
      tool_use_id: "toolu_abc",
      tool_input: { command: "exit 1" },
      error: "Command exited with status 1",
      hook_specific_output: {
        hookEventName: "PostToolUseFailure",
        additionalContext: "context",
        systemMessage: "Bash failed",
      },
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.hook_event_name === "PostToolUseFailure") {
      expect(result.data.tool_name).toBe("Bash");
      expect(result.data.error).toBe("Command exited with status 1");
    }
  });

  it("rejects PostToolUseFailure with unknown top-level field", () => {
    const result = HookEventEnvelope.safeParse({
      ...baseEnvelope,
      hook_event_name: "PostToolUseFailure",
      tool_name: "Bash",
      tool_input: { command: "ls" },
      surprise: "field",
    });
    expect(result.success).toBe(false);
  });

  it("parses UserPromptSubmit event", () => {
    const result = HookEventEnvelope.safeParse({
      ...baseEnvelope,
      hook_event_name: "UserPromptSubmit",
      prompt: "fix the login bug",
    });
    expect(result.success).toBe(true);
  });

  it("parses Notification event", () => {
    const result = HookEventEnvelope.safeParse({
      ...baseEnvelope,
      hook_event_name: "Notification",
      message: "Claude is waiting for your input",
    });
    expect(result.success).toBe(true);
  });

  it("parses SubagentStop event", () => {
    const result = HookEventEnvelope.safeParse({
      ...baseEnvelope,
      hook_event_name: "SubagentStop",
    });
    expect(result.success).toBe(true);
  });

  it("parses SubagentStart event with agent_type, agent_id, and agent_config", () => {
    const result = HookEventEnvelope.safeParse({
      ...baseEnvelope,
      hook_event_name: "SubagentStart",
      agent_type: "general-purpose",
      agent_id: "sub-456",
      agent_config: {
        model: "claude-sonnet-4-6",
        system_prompt: "you are focused",
        tools: ["Read", "Grep"],
        description: "research",
      },
      hook_specific_output: {
        hookEventName: "SubagentStart",
        additionalContext: "use absolute paths",
      },
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.hook_event_name === "SubagentStart") {
      expect(result.data.agent_type).toBe("general-purpose");
      expect(result.data.agent_id).toBe("sub-456");
      expect(result.data.agent_config?.model).toBe("claude-sonnet-4-6");
    }
  });

  it("parses SubagentStart event with no optional fields", () => {
    const result = HookEventEnvelope.safeParse({
      ...baseEnvelope,
      hook_event_name: "SubagentStart",
    });
    expect(result.success).toBe(true);
  });

  it("rejects SubagentStart with unknown top-level field", () => {
    const result = HookEventEnvelope.safeParse({
      ...baseEnvelope,
      hook_event_name: "SubagentStart",
      agent_type: "general-purpose",
      surprise: "field",
    });
    expect(result.success).toBe(false);
  });

  it("rejects SubagentStart with unknown agent_config field", () => {
    const result = HookEventEnvelope.safeParse({
      ...baseEnvelope,
      hook_event_name: "SubagentStart",
      agent_config: { model: "x", brand_new: "field" },
    });
    expect(result.success).toBe(false);
  });

  it("parses PreCompact event", () => {
    const result = HookEventEnvelope.safeParse({
      ...baseEnvelope,
      hook_event_name: "PreCompact",
      trigger: "auto",
    });
    expect(result.success).toBe(true);
  });

  it("parses TaskCompleted event", () => {
    const result = HookEventEnvelope.safeParse({
      ...baseEnvelope,
      hook_event_name: "TaskCompleted",
      task_id: "task-001",
      task_subject: "Build auth",
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown event types", () => {
    const result = HookEventEnvelope.safeParse({
      ...baseEnvelope,
      hook_event_name: "Unknown",
    });
    expect(result.success).toBe(false);
  });

  it("requires transcript_path on every event", () => {
    const result = HookEventEnvelope.safeParse({
      session_id: "abc123",
      cwd: "/home/user/project",
      hook_event_name: "Stop",
    });
    expect(result.success).toBe(false);
  });

  it("requires cwd on every event", () => {
    const result = HookEventEnvelope.safeParse({
      session_id: "abc123",
      transcript_path: "/x/y.jsonl",
      hook_event_name: "Stop",
    });
    expect(result.success).toBe(false);
  });
});

describe("DOMAIN_EVENTS", () => {
  it("exposes the new domain-level event vocabulary", () => {
    expect(DOMAIN_EVENTS.SESSION_ADDED).toBe("session:added");
    expect(DOMAIN_EVENTS.SESSION_REMOVED).toBe("session:removed");
    expect(DOMAIN_EVENTS.SESSION_UPDATED).toBe("session:updated");
    expect(DOMAIN_EVENTS.SESSION_STARTED).toBe("session:started");
    expect(DOMAIN_EVENTS.SESSION_ENDED).toBe("session:ended");
    expect(DOMAIN_EVENTS.PLAN_CHANGED).toBe("plan:changed");
    expect(DOMAIN_EVENTS.PLAN_REMOVED).toBe("plan:removed");
    expect(DOMAIN_EVENTS.MEMORY_CHANGED).toBe("memory:changed");
    expect(DOMAIN_EVENTS.MEMORY_REMOVED).toBe("memory:removed");
    expect(DOMAIN_EVENTS.TASK_CHANGED).toBe("task:changed");
    expect(DOMAIN_EVENTS.TASK_COMPLETED).toBe("task:completed");
    expect(DOMAIN_EVENTS.SUBAGENT_STARTED).toBe("subagent:started");
  });

  it("remains distinct from the surviving SSE_EVENTS lifecycle signals", () => {
    // The surviving SESSION_START / SESSION_END lifecycle signals must stay
    // distinct from the new added / removed / updated domain deltas.
    expect(DOMAIN_EVENTS.SESSION_ADDED).not.toBe(SSE_EVENTS.SESSION_START);
    expect(DOMAIN_EVENTS.SESSION_REMOVED).not.toBe(SSE_EVENTS.SESSION_END);
    expect(DOMAIN_EVENTS.SESSION_STARTED).not.toBe(SSE_EVENTS.SESSION_START);
    expect(DOMAIN_EVENTS.SESSION_ENDED).not.toBe(SSE_EVENTS.SESSION_END);
  });
});

describe("diffEntityMaps", () => {
  type Entity = { id: string; version: number };
  const equals = (a: Entity, b: Entity) => a.version === b.version;

  it("detects added entries present in next but not previous", () => {
    const previous = new Map<string, Entity>();
    const next = new Map([["a", { id: "a", version: 1 }]]);

    expect(diffEntityMaps(previous, next, equals)).toStrictEqual({
      added: [{ id: "a", version: 1 }],
      removed: [],
      updated: [],
    });
  });

  it("detects removed entries present in previous but not next", () => {
    const previous = new Map([["a", { id: "a", version: 1 }]]);
    const next = new Map<string, Entity>();

    expect(diffEntityMaps(previous, next, equals)).toStrictEqual({
      added: [],
      removed: ["a"],
      updated: [],
    });
  });

  it("detects updated entries whose value differs by the custom comparator", () => {
    const previous = new Map([["a", { id: "a", version: 1 }]]);
    const next = new Map([["a", { id: "a", version: 2 }]]);

    expect(diffEntityMaps(previous, next, equals)).toStrictEqual({
      added: [],
      removed: [],
      updated: [{ id: "a", version: 2 }],
    });
  });

  it("treats equal entries as unchanged", () => {
    const previous = new Map([["a", { id: "a", version: 1 }]]);
    const next = new Map([["a", { id: "a", version: 1 }]]);

    expect(diffEntityMaps(previous, next, equals)).toStrictEqual({
      added: [],
      removed: [],
      updated: [],
    });
  });

  it("handles mixed adds, removes, and updates in a single pass", () => {
    const previous = new Map([
      ["a", { id: "a", version: 1 }],
      ["b", { id: "b", version: 1 }],
    ]);
    const next = new Map([
      ["b", { id: "b", version: 2 }],
      ["c", { id: "c", version: 1 }],
    ]);

    expect(diffEntityMaps(previous, next, equals)).toStrictEqual({
      added: [{ id: "c", version: 1 }],
      removed: ["a"],
      updated: [{ id: "b", version: 2 }],
    });
  });
});
