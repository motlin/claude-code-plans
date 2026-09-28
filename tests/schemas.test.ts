import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  SessionIndexEntrySchema,
  SessionsIndexSchema,
  CustomTitleRecordSchema,
  FileHistorySnapshotSchema,
  UserRecordSchema,
  AssistantRecordSchema,
  ProgressRecordSchema,
  SystemRecordSchema,
  LastPromptRecordSchema,
  QueueOperationRecordSchema,
  TextBlockSchema,
  ToolUseBlockSchema,
  ThinkingBlockSchema,
  ToolResultBlockSchema,
  ContentBlockSchema,
  JsonlRecordSchema,
  parseJsonlRecord,
  TaskFileSchema,
} from "../src/lib/schemas";
import {
  BashInputSchema,
  ReadInputSchema,
  EditInputSchema,
  WriteInputSchema,
  GlobInputSchema,
  GrepInputSchema,
  AgentInputSchema,
  toolInputSchemas,
} from "../src/lib/tool-input-schemas";
import { baseFields } from "./fixtures/base-fields";

describe("SessionIndexEntrySchema", () => {
  it("parses a minimal entry", () => {
    const entry = {
      sessionId: "abc-123",
      fullPath: "/path/to/abc-123.jsonl",
      fileMtime: 1234567890,
    };
    const result = SessionIndexEntrySchema.safeParse(entry);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sessionId).toBe("abc-123");
    }
  });

  it("parses a full entry with all optional fields", () => {
    const entry = {
      sessionId: "abc-123",
      fullPath: "/path/to/abc-123.jsonl",
      fileMtime: 1234567890,
      firstPrompt: "Fix the bug",
      summary: "Fixed auth issue",
      messageCount: 5,
      created: "1999-12-31T00:00:00.000Z",
      modified: "2000-01-01T00:00:00.000Z",
      gitBranch: "main",
      projectPath: "/Users/craig/projects/app",
      isSidechain: false,
    };
    const result = SessionIndexEntrySchema.safeParse(entry);
    expect(result.success).toBe(true);
  });

  it("rejects unknown fields", () => {
    const entry = {
      sessionId: "abc-123",
      fullPath: "/path/to/abc-123.jsonl",
      fileMtime: 1234567890,
      unknownField: "hello",
    };
    const result = SessionIndexEntrySchema.safeParse(entry);
    expect(result.success).toBe(false);
  });
});

describe("SessionsIndexSchema", () => {
  it("parses a sessions index with entries", () => {
    const data = {
      version: 1,
      entries: [
        {
          sessionId: "abc-123",
          fullPath: "/path/abc-123.jsonl",
          fileMtime: 1234567890,
        },
      ],
    };
    const result = SessionsIndexSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it("accepts the originalPath field", () => {
    const data = {
      version: 1,
      entries: [],
      originalPath: "/Users/craig/.claude/projects/proj/sessions-index.json",
    };
    const result = SessionsIndexSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.originalPath).toBe(
        "/Users/craig/.claude/projects/proj/sessions-index.json",
      );
    }
  });

  it("rejects unknown top-level fields", () => {
    const data = {
      version: 1,
      entries: [],
      bogusField: true,
    };
    const result = SessionsIndexSchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});

describe("CustomTitleRecordSchema", () => {
  it("parses a custom-title record", () => {
    const record = {
      type: "custom-title",
      customTitle: "My Session",
      sessionId: "abc-123",
    };
    const result = CustomTitleRecordSchema.safeParse(record);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.customTitle).toBe("My Session");
    }
  });

  it("rejects wrong type literal", () => {
    const record = {
      type: "user",
      customTitle: "My Session",
      sessionId: "abc-123",
    };
    const result = CustomTitleRecordSchema.safeParse(record);
    expect(result.success).toBe(false);
  });
});

describe("FileHistorySnapshotSchema", () => {
  it("parses a file-history-snapshot with tracked file backups", () => {
    const record = {
      type: "file-history-snapshot",
      messageId: "msg-123",
      snapshot: {
        messageId: "msg-123",
        trackedFileBackups: {
          "/Users/craig/.claude/plans/my-plan.md": "backup-content",
        },
        timestamp: "1999-12-31T00:00:00.000Z",
      },
      isSnapshotUpdate: false,
    };
    const result = FileHistorySnapshotSchema.safeParse(record);
    expect(result.success).toBe(true);
  });
});

describe("content block schemas", () => {
  it("parses a text block", () => {
    const block = { type: "text", text: "Hello world" };
    const result = TextBlockSchema.safeParse(block);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.text).toBe("Hello world");
    }
  });

  it("parses a tool_use block", () => {
    const block = {
      type: "tool_use",
      id: "tu_123",
      name: "Read",
      input: { file_path: "/src/index.ts" },
    };
    const result = ToolUseBlockSchema.safeParse(block);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Read");
      expect(result.data.id).toBe("tu_123");
    }
  });

  it("parses a tool_use block with caller field", () => {
    const block = {
      type: "tool_use",
      id: "tu_123",
      name: "Read",
      input: { file_path: "/src/index.ts" },
      caller: "user",
    };
    const result = ToolUseBlockSchema.safeParse(block);
    expect(result.success).toBe(true);
  });

  it("parses a tool_use block with newer Agent effort input", () => {
    const block = {
      type: "tool_use",
      id: "tu_123",
      name: "Agent",
      input: {
        description: "Review the change",
        prompt: "Find risks",
        effort: "high",
      },
    };
    const result = ContentBlockSchema.safeParse(block);
    expect(result.success).toBe(true);
  });

  it("parses a tool_use block with TaskCreate active form and no subject", () => {
    const block = {
      type: "tool_use",
      id: "tu_123",
      name: "TaskCreate",
      input: {
        description: "Implement the next slice",
        activeForm: "Implementing the next slice",
      },
    };
    const result = ContentBlockSchema.safeParse(block);
    expect(result.success).toBe(true);
  });

  it("parses a tool_use block with a SendMessage shutdown response", () => {
    const block = {
      type: "tool_use",
      id: "tu_123",
      name: "SendMessage",
      input: {
        to: "team-lead",
        message: { type: "shutdown_response", request_id: "shutdown-177@world2", approve: true },
        type: "shutdown_response",
        recipient: "team-lead",
        request_id: "shutdown-177@world2",
        approve: true,
      },
    };
    const result = ContentBlockSchema.safeParse(block);
    expect(result.success).toBe(true);
  });

  it("parses a thinking block", () => {
    const block = {
      type: "thinking",
      thinking: "Let me analyze...",
      signature: "sig-abc",
    };
    const result = ThinkingBlockSchema.safeParse(block);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.thinking).toBe("Let me analyze...");
    }
  });

  it("parses a tool_result block with string content", () => {
    const block = {
      type: "tool_result",
      tool_use_id: "tu_123",
      content: "file contents here",
    };
    const result = ToolResultBlockSchema.safeParse(block);
    expect(result.success).toBe(true);
  });

  it("parses a tool_result block with array content", () => {
    const block = {
      type: "tool_result",
      tool_use_id: "tu_123",
      content: [{ type: "text", text: "line 1" }],
    };
    const result = ToolResultBlockSchema.safeParse(block);
    expect(result.success).toBe(true);
  });

  it("parses a tool_result with is_error flag", () => {
    const block = {
      type: "tool_result",
      tool_use_id: "tu_123",
      content: "not found",
      is_error: true,
    };
    const result = ToolResultBlockSchema.safeParse(block);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.is_error).toBe(true);
    }
  });
});

const assistantMessageFields = {
  role: "assistant" as const,
  model: "claude-opus-4-6",
  id: "msg_123",
  type: "message",
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 100, output_tokens: 50 },
  stop_details: null,
};

describe("UserRecordSchema", () => {
  it("parses a user record with string content", () => {
    const record = {
      type: "user",
      ...baseFields,
      message: { role: "user", content: "Fix the bug" },
    };
    const result = UserRecordSchema.safeParse(record);
    expect(result.success).toBe(true);
  });

  it("parses a user record with array content", () => {
    const record = {
      type: "user",
      ...baseFields,
      message: {
        role: "user",
        content: [
          { type: "text", text: "Hello" },
          { type: "tool_result", tool_use_id: "tu_1", content: "result" },
        ],
      },
    };
    const result = UserRecordSchema.safeParse(record);
    expect(result.success).toBe(true);
  });

  it("accepts optional fields like slug", () => {
    const record = {
      type: "user",
      ...baseFields,
      slug: "radiant-beaming-kay",
      message: { role: "user", content: "Hello" },
    };
    const result = UserRecordSchema.safeParse(record);
    expect(result.success).toBe(true);
  });

  it("accepts queue priority metadata", () => {
    const record = {
      type: "user",
      ...baseFields,
      message: { role: "user", content: "Background agents were stopped by the user." },
      promptSource: "system",
      queuePriority: "later",
      userFeedback: "Please preserve the current behavior.",
    };

    expect(UserRecordSchema.parse(record)).toStrictEqual(record);
  });
});

describe("AssistantRecordSchema", () => {
  it("parses an assistant record with content blocks", () => {
    const record = {
      type: "assistant",
      ...baseFields,
      requestId: "req_123",
      message: {
        ...assistantMessageFields,
        content: [
          { type: "text", text: "Here is my answer" },
          {
            type: "tool_use",
            id: "tu_1",
            name: "Read",
            input: { file_path: "/foo" },
          },
        ],
      },
    };
    const result = AssistantRecordSchema.safeParse(record);
    expect(result.success).toBe(true);
  });

  it("accepts optional fields like slug", () => {
    const record = {
      type: "assistant",
      ...baseFields,
      requestId: "req_123",
      slug: "radiant-beaming-kay",
      effort: "high",
      healsDistinctCarrier: true,
      isAbortedMidStream: true,
      message: {
        ...assistantMessageFields,
        content: [{ type: "text", text: "Hi" }],
      },
    };
    expect(AssistantRecordSchema.parse(record)).toStrictEqual(record);
  });

  it("accepts newer snake_case session_id metadata", () => {
    const record = {
      type: "assistant",
      ...baseFields,
      session_id: "sess-123",
      requestId: "req_123",
      message: {
        ...assistantMessageFields,
        content: [{ type: "text", text: "Hi" }],
      },
    };
    const result = AssistantRecordSchema.safeParse(record);
    expect(result.success).toBe(true);
  });
});

describe("ProgressRecordSchema", () => {
  it("parses a progress record", () => {
    const record = {
      type: "progress",
      ...baseFields,
      data: { type: "hook_progress", hookEvent: "SessionStart" },
    };
    const result = ProgressRecordSchema.safeParse(record);
    expect(result.success).toBe(true);
  });
});

describe("SystemRecordSchema", () => {
  it("parses a system record with subtype", () => {
    const record = {
      type: "system",
      ...baseFields,
      subtype: "turn_duration",
      durationMs: 5000,
      preventContinuation: true,
    };

    expect(SystemRecordSchema.parse(record)).toStrictEqual(record);
  });

  it("parses the request retry source", () => {
    const record = {
      type: "system",
      subtype: "api_error",
      source: "request_retry",
    };

    expect(SystemRecordSchema.parse(record)).toStrictEqual(record);
  });
});

describe("LastPromptRecordSchema", () => {
  it("parses a last-prompt record", () => {
    const record = {
      type: "last-prompt",
      lastPrompt: "Fix the login bug",
      explicit: true,
      sessionId: "sess-123",
    };

    expect(LastPromptRecordSchema.parse(record)).toStrictEqual(record);
  });
});

describe("QueueOperationRecordSchema", () => {
  it("parses a queue-operation record", () => {
    const record = {
      type: "queue-operation",
      operation: "enqueue",
      timestamp: "1999-12-31T00:00:00.000Z",
      sessionId: "sess-123",
      content: "task notification content",
    };
    const result = QueueOperationRecordSchema.safeParse(record);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.operation).toBe("enqueue");
    }
  });
});

describe("JsonlRecordSchema", () => {
  it("parses hook-cancelled attachment records with timeout metadata", () => {
    const result = JsonlRecordSchema.safeParse({
      type: "attachment",
      ...baseFields,
      attachment: {
        type: "hook_cancelled",
        hookName: "PreToolUse:Bash",
        toolUseID: "toolu_100",
        hookEvent: "PreToolUse",
        command: "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/pretooluse.py",
        durationMs: 10045,
        timedOut: true,
        timeoutMs: 10000,
      },
    });
    expect(result.success).toBe(true);
  });

  it("parses team context attachments naming the agent and its team", () => {
    const record = {
      type: "attachment",
      attachment: {
        type: "team_context",
        agentId: "item-refiner-2@session-2102dbaf",
        agentName: "item-refiner-2",
        teamName: "session-2102dbaf",
        teamConfigPath: "/Users/craig/.claude/teams/session-2102dbaf/config.json",
        taskListPath: "/Users/craig/.claude/tasks/session-2102dbaf/",
      },
    };

    expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
  });

  it("parses subagent assistant records carrying the attributing agent type", () => {
    const record = {
      type: "assistant",
      ...baseFields,
      isSidechain: true,
      agentId: "abd1368f74dfe3095",
      attributionAgent: "markdown-tasks:do-task",
      message: { role: "assistant", content: [{ type: "text", text: "Working on it." }] },
    };

    expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
  });

  it("parses auto mode attachments with consent flow metadata", () => {
    const record = {
      type: "attachment",
      attachment: {
        type: "auto_mode",
        autoModeConsentFlow: false,
        bashFirst: false,
        steerOnly: false,
        bypass: false,
      },
    };

    expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
  });

  it("parses user records", () => {
    const record = {
      type: "user",
      ...baseFields,
      message: { role: "user", content: "Hello" },
    };
    const result = JsonlRecordSchema.safeParse(record);
    expect(result.success).toBe(true);
  });

  it("parses user records with current session and queue metadata", () => {
    const result = JsonlRecordSchema.safeParse({
      type: "user",
      ...baseFields,
      session_id: "session-100",
      queuePriority: "later",
      message: { role: "user", content: "Queued prompt" },
    });
    expect(result.success).toBe(true);
  });

  it("parses user records with tool denial metadata", () => {
    const result = JsonlRecordSchema.safeParse({
      type: "user",
      ...baseFields,
      message: { role: "user", content: [] },
      toolUseResult: "Error: permission denied",
      toolDenialKind: "permission-rule",
    });
    expect(result.success).toBe(true);
  });

  it("parses user records interrupted by shutdown", () => {
    const record = {
      type: "user",
      ...baseFields,
      message: { role: "user", content: "Continue the task" },
      interruptedByShutdown: true,
    };

    expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
  });

  it("parses assistant records", () => {
    const record = {
      type: "assistant",
      ...baseFields,
      requestId: "req_123",
      message: {
        ...assistantMessageFields,
        content: [{ type: "text", text: "Hi" }],
      },
    };
    const result = JsonlRecordSchema.safeParse(record);
    expect(result.success).toBe(true);
  });

  it("parses assistant records with snake_case session id", () => {
    const result = JsonlRecordSchema.safeParse({
      type: "assistant",
      ...baseFields,
      session_id: "sess-123",
      message: {
        ...assistantMessageFields,
        content: [{ type: "text", text: "Hi" }],
      },
    });
    expect(result.success).toBe(true);
  });

  it("parses TaskCreate tool uses without a subject", () => {
    const result = JsonlRecordSchema.safeParse({
      type: "assistant",
      ...baseFields,
      message: {
        ...assistantMessageFields,
        content: [
          {
            type: "tool_use",
            id: "toolu_123",
            name: "TaskCreate",
            input: {
              description: "Fill in the implementation details",
              activeForm: "Implementing",
            },
          },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it("parses Agent tool uses with effort", () => {
    const result = JsonlRecordSchema.safeParse({
      type: "assistant",
      ...baseFields,
      message: {
        ...assistantMessageFields,
        content: [
          {
            type: "tool_use",
            id: "toolu_123",
            name: "Agent",
            input: {
              prompt: "Inspect the code",
              model: "sonnet",
              effort: "high",
            },
          },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it("parses custom-title records", () => {
    const result = JsonlRecordSchema.safeParse({
      type: "custom-title",
      customTitle: "Title",
      sessionId: "sess-123",
    });
    expect(result.success).toBe(true);
  });

  it("parses progress records", () => {
    const result = JsonlRecordSchema.safeParse({
      type: "progress",
      ...baseFields,
      data: { type: "hook_progress" },
    });
    expect(result.success).toBe(true);
  });

  it("parses system records", () => {
    const result = JsonlRecordSchema.safeParse({
      type: "system",
      ...baseFields,
      subtype: "stop_hook_summary",
    });
    expect(result.success).toBe(true);
  });

  it("parses file-history-snapshot records", () => {
    const result = JsonlRecordSchema.safeParse({
      type: "file-history-snapshot",
      messageId: "msg-123",
      isSnapshotUpdate: false,
      snapshot: {
        messageId: "msg-123",
        timestamp: "1999-12-31T00:00:00.000Z",
        trackedFileBackups: {},
      },
    });
    expect(result.success).toBe(true);
  });

  it("parses last-prompt records", () => {
    const result = JsonlRecordSchema.safeParse({
      type: "last-prompt",
      lastPrompt: "Fix it",
      sessionId: "sess-123",
    });
    expect(result.success).toBe(true);
  });

  it("parses queue-operation records", () => {
    const result = JsonlRecordSchema.safeParse({
      type: "queue-operation",
      operation: "dequeue",
      timestamp: "1999-12-31T00:00:00.000Z",
      sessionId: "sess-123",
      content: "stuff",
    });
    expect(result.success).toBe(true);
  });

  it("parses queued command attachments with meta markers", () => {
    const result = JsonlRecordSchema.safeParse({
      type: "attachment",
      ...baseFields,
      attachment: {
        type: "queued_command",
        prompt: "Run the queued test command",
        commandMode: "prompt",
        timestamp: "1999-12-31T00:00:00.000Z",
        isMeta: true,
      },
    });
    expect(result.success).toBe(true);
  });

  it("parses dynamic skill attachments", () => {
    const result = JsonlRecordSchema.safeParse({
      type: "attachment",
      ...baseFields,
      attachment: {
        type: "dynamic_skill",
        skillDir: "/tmp/test/.claude/skills",
        skillNames: ["alice-skill"],
        displayPath: "test/.claude/skills",
      },
    });
    expect(result.success).toBe(true);
  });

  it("parses async hook response attachments", () => {
    const result = JsonlRecordSchema.safeParse({
      type: "attachment",
      ...baseFields,
      attachment: {
        type: "async_hook_response",
        processId: "async-hook-100",
        hookName: "PreToolUse:Read",
        hookEvent: "PreToolUse",
        response: { decision: "allow" },
        stdout: "allowed",
        stderr: "",
        exitCode: 0,
      },
    });
    expect(result.success).toBe(true);
  });

  it("parses already-read file attachments", () => {
    const result = JsonlRecordSchema.safeParse({
      type: "attachment",
      ...baseFields,
      attachment: {
        type: "already_read_file",
        filename: "/tmp/test/example.ts",
        displayPath: "example.ts",
        content: { type: "text" },
      },
    });
    expect(result.success).toBe(true);
  });

  it("parses task status attachments", () => {
    const result = JsonlRecordSchema.safeParse({
      type: "attachment",
      ...baseFields,
      attachment: {
        type: "task_status",
        taskId: "task-100",
        taskType: "local_agent",
        description: "Example task",
        status: "completed",
        deltaSummary: null,
        outputFilePath: "/tmp/test/task-100.output",
      },
    });
    expect(result.success).toBe(true);
  });

  it("parses total token reminder attachments", () => {
    const record = {
      type: "attachment",
      ...baseFields,
      attachment: {
        type: "total_tokens_reminder",
        text: "<total_tokens>10000000 tokens left</total_tokens>",
      },
    };

    expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
  });

  it("parses fork context references", () => {
    const record = {
      type: "fork-context-ref",
      agentId: "agent-alice-100",
      parentSessionId: "session-alice-100",
      parentLastUuid: "message-alice-100",
      contextLength: 100,
    };

    expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
  });

  it("parses relocated records", () => {
    const result = JsonlRecordSchema.safeParse({
      type: "relocated",
      sessionId: "session-100",
      relocatedCwd: "/tmp/test/worktree",
    });
    expect(result.success).toBe(true);
  });

  it("parses worktree state with the pre-entry directory", () => {
    const record = {
      type: "worktree-state",
      sessionId: "session-100",
      worktreeSession: {
        originalCwd: "/tmp/test/project",
        preEnterOriginalCwd: "/tmp/test/project",
        worktreePath: "/tmp/test/worktree",
        worktreeName: "alice-worktree",
        worktreeBranch: "test/alice-worktree",
        sessionId: "session-100",
      },
    };

    expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
  });

  it("parses hook-based worktree state without a Git branch", () => {
    const record = {
      type: "worktree-state",
      sessionId: "session-100",
      worktreeSession: {
        originalCwd: "/tmp/test/project",
        preEnterOriginalCwd: "/tmp/test/project",
        worktreePath: "/tmp/test/worktree",
        worktreeName: "alice-worktree",
        sessionId: "session-100",
        hookBased: true,
      },
    };

    expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
  });

  it("parses user records with agentId (subagent sessions)", () => {
    const result = JsonlRecordSchema.safeParse({
      type: "user",
      ...baseFields,
      agentId: "agent-abc123def456",
      message: { role: "user", content: "Hello from subagent" },
    });
    expect(result.success).toBe(true);
  });

  it("parses assistant records with agentId (subagent sessions)", () => {
    const result = JsonlRecordSchema.safeParse({
      type: "assistant",
      ...baseFields,
      agentId: "agent-abc123def456",
      requestId: "req_456",
      message: {
        ...assistantMessageFields,
        content: [{ type: "text", text: "Response from subagent" }],
      },
    });
    expect(result.success).toBe(true);
  });
});

describe("JsonlRecordSchema observed 2026-09 transcript fields", () => {
  const rendered = [
    { content: "<system-reminder>\nToday's date is 2026-09-28.\n</system-reminder>" },
  ];

  function attachmentRecord(attachment: Record<string, unknown>) {
    return { type: "attachment", ...baseFields, attachment, rendered };
  }

  it("parses assistant records carrying wire metadata, per-turn effort, and input transformations", () => {
    const record = {
      type: "assistant",
      ...baseFields,
      requestId: "req_1",
      advisorModel: "claude-opus-5-5",
      apiBlockIndex: 2,
      perTurnEffort: null,
      serverClassifierRequest: "931e5375-552d-4f2d-9c4c-4a60cd3903d0",
      truncatedAfterOutput: true,
      wireIngestContext: { toolu_1: { cwd: "/Users/test/project" } },
      wireToolInputs: { toolu_1: { command: "ls", description: "List files" } },
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Done." }],
        input_transformations: [
          {
            type: "thinking_dropped",
            path: "messages.2.content.0",
            reason: "prefix_binding_mismatch",
          },
        ],
        safeguard_results: [
          {
            type: "dangerous_tool_use",
            status: {
              type: "available",
              tool_uses: { toolu_1: { type: "evaluated", outcome: "not_flagged" } },
            },
          },
        ],
      },
    };

    expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
  });

  it("parses user records carrying turn origin, scheduled-task, and classifier context fields", () => {
    const record = {
      type: "user",
      ...baseFields,
      message: { role: "user", content: "hello" },
      promptSource: "suggestion_accepted",
      turnOrigin: "scheduled",
      turnPosition: { promptIndex: 1, turnIndex: 1 },
      turnCompanion: true,
      queueSkipAttachments: true,
      scheduledTaskId: "cdaf9a4d",
      scheduledFireId: "26b2889b-5fe9-4a7b-ad8c-ed24a3678f56",
      classifierMetaLines: '{"meta":{"gitStatus":{"clean":true}}}\n',
      serverClassifierContext: {
        request: "931e5375-552d-4f2d-9c4c-4a60cd3903d0",
        context: {
          git_state: {
            cwd: "/Users/test/project",
            root: "/Users/test/project",
            branch: "main",
            default_branch: "main",
            status: {
              clean: false,
              counts: { staged: 0, modified: 2, untracked: null, untracked_normal: 1 },
              porcelain: null,
              truncated: false,
            },
            visibility: {
              origin: { host: "github.com", remote: "test/project", visibility: "public" },
              push_remote: "origin",
              remotes: [
                {
                  name: "origin",
                  host: "github.com",
                  remote: "test/project",
                  visibility: "public",
                },
              ],
              visibility_cache: [
                { host: "github.com", remote: "test/project", visibility: "public" },
              ],
            },
          },
          live_cwd: "/Users/test/project",
          platform: "macos",
        },
      },
    };

    expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
  });

  it("parses classifier context whose git state is still pending", () => {
    const record = {
      type: "user",
      ...baseFields,
      message: { role: "user", content: "hello" },
      serverClassifierContext: {
        request: "r1",
        context: {
          git_state: {
            cwd: "/tmp",
            root: null,
            branch: null,
            default_branch: null,
            status: null,
            visibility: null,
            error: "pending",
          },
          live_cwd: "/tmp",
          platform: "macos",
        },
      },
    };

    expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
  });

  it("parses system records for local commands, bridge status, and scheduled task fires", () => {
    const records = [
      {
        type: "system",
        ...baseFields,
        subtype: "local_command",
        content: "<command-name>/rename</command-name>",
        commandRun: { command: "rename", args: "daily" },
      },
      {
        type: "system",
        ...baseFields,
        subtype: "bridge_status",
        content: "Remote Control connected",
        url: "https://claude.ai/code/session_01",
      },
      {
        type: "system",
        ...baseFields,
        subtype: "scheduled_task_fire",
        content: "Scheduled task fired",
        taskId: "cdaf9a4d",
        cron: "45 15 * * *",
        prompt: "/loop Check the PR",
        taskKind: "loop",
        cronKind: "loop",
        noOpStreak: 2,
        streakStartedAt: "2026-09-28T19:45:00.751Z",
        foldedUuids: ["26b2889b-5fe9-4a7b-ad8c-ed24a3678f56"],
      },
    ];

    expect(records.map((record) => JsonlRecordSchema.parse(record))).toStrictEqual(records);
  });

  it("parses queue removals that record why the prompt left the queue", () => {
    const record = {
      type: "queue-operation",
      operation: "remove",
      timestamp: "2026-09-28T00:00:00.000Z",
      sessionId: "s1",
      content: "queued prompt",
      reason: "absorbed_mid_turn",
    };

    expect(JsonlRecordSchema.parse(record)).toStrictEqual(record);
  });

  it("parses session bookkeeping records for bridges, costs, artifacts, and ATIS latches", () => {
    const records = [
      { type: "atis-latch", atis: "v1.f775a7368a120dff.MKr6", sessionId: "s1" },
      {
        type: "bridge-session",
        sessionId: "s1",
        bridgeSessionId: "cse_01",
        lastSequenceNum: 87,
        ownerAccountUuid: "acct-1",
        ownerOrganizationUuid: "org-1",
      },
      {
        type: "cost-state",
        sessionId: "s1",
        totalCostUSD: 1.5,
        totalAPIDuration: 1000,
        totalAPIDurationWithoutRetries: 990,
        totalToolDuration: 200,
        totalLinesAdded: 10,
        totalLinesRemoved: 2,
        totalDuration: 5000,
        startTime: 1790602944268,
        modelUsage: {
          "claude-opus-5-5": {
            inputTokens: 10,
            outputTokens: 20,
            thinkingTokens: 5,
            cacheReadInputTokens: 100,
            cacheCreationInputTokens: 50,
            webSearchRequests: 0,
            costUSD: 1.5,
          },
        },
        hasUnknownModelCost: false,
      },
      {
        type: "frame-link",
        sessionId: "s1",
        path: "/tmp/page.html",
        frameUrl: "https://claude.ai/code/artifact/abc",
        title: "Board Styles",
        artifactCount: 1,
        timestamp: "2026-09-28T17:22:33.770Z",
      },
      {
        type: "artifact-comment-monitor",
        v: 1,
        sessionId: "s1",
        artifacts: {
          "https://claude.ai/code/artifact/abc": { state: "armed", writtenAtMs: 1, title: "Board" },
        },
      },
      {
        type: "artifact-autoreact-ledger",
        v: 1,
        sessionId: "s1",
        accountUuid: "acct-1",
        artifacts: {
          "https://claude.ai/code/artifact/abc": {
            savedAt: 1,
            stampHighWater: null,
            everBaselined: true,
            everHadThreads: false,
            turnTimestamps: [],
            threads: [],
            interrupted: true,
          },
        },
      },
    ];

    expect(records.map((record) => JsonlRecordSchema.parse(record))).toStrictEqual(records);
  });

  it("parses rendered context attachments for environment, instructions, model, and session context", () => {
    const records = [
      attachmentRecord({ type: "date", date: "2026-09-28", changed: true }),
      attachmentRecord({
        type: "environment",
        snapshot: {
          workingDirectory: "/Users/test/project",
          isWorktree: false,
          isGitRepo: true,
          additionalWorkingDirectories: ["/Users/test/.claude"],
          platform: "darwin",
          shell: "zsh",
          osVersion: "Darwin 24.6.0",
          scratchpadDirectory: "/tmp/scratch",
        },
        changes: [
          { field: "workingDirectory", from: "/Users/test/other" },
          { field: "additionalWorkingDirectories", added: ["/Users/test/Downloads"], removed: [] },
        ],
      }),
      attachmentRecord({
        type: "instructions",
        files: [{ path: "/Users/test/.claude/CLAUDE.md", type: "User", content: "Be terse." }],
        changed: true,
        reason: "session_start",
        removed: ["/Users/test/project/AGENTS.md"],
      }),
      attachmentRecord({
        type: "model",
        identity: {
          modelId: "claude-opus-5-5",
          marketingName: "Opus 5.5",
          knowledgeCutoff: "June 2026",
        },
        text: "You are powered by the model named Opus 5.5.",
      }),
      attachmentRecord({
        type: "session_context",
        context: { userEmail: "The user's email is test@example.com." },
      }),
      attachmentRecord({ type: "credential_org", organizationUuid: "org-1" }),
      attachmentRecord({ type: "output_style", style: "Concise", turnReminder: "Be concise." }),
      attachmentRecord({
        type: "output_style_instructions",
        style: { name: "Concise", prompt: "Keep it short." },
      }),
      attachmentRecord({
        type: "remote_session_change",
        url: null,
        commit: "",
        pr: "",
        sendUserFileHint: true,
        managedCommit: false,
        managedPr: false,
      }),
      attachmentRecord({ type: "fork_briefing", text: "This conversation was forked." }),
    ];

    expect(records.map((record) => JsonlRecordSchema.parse(record))).toStrictEqual(records);
  });

  it("parses prompt snapshot and deferred tool record attachments", () => {
    const records = [
      attachmentRecord({
        type: "prompt_snapshot",
        systemPrompt: ["You are an interactive agent.", "__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__"],
        reminderFold: false,
        echoWireToolInputs: true,
        contextRendering: "announced",
        tools: [{ name: "Bash", description: "Run a command", schema: { type: "object" } }],
        cliPrefix: "You are Claude Code.",
        systemTurns: true,
        toolChangeHeader: true,
        inlineTools: false,
        keptReminders: true,
        hostPrompt: "f7a1a5925fe3c21c",
      }),
      attachmentRecord({
        type: "deferred_tools_record",
        entries: [
          {
            name: "mcp__docs__guide",
            description: "Docs guides",
            input_schema: { type: "object", properties: {} },
            eager_input_streaming: true,
            defer_loading: true,
          },
        ],
        toolInputCopies: [{ id: "toolu_1", copy: "wire" }],
        nameOnlyAnnouncements: ["e1a46492-d54a-4f2b-94a3-82a1c5c174cf"],
      }),
    ];

    expect(records.map((record) => JsonlRecordSchema.parse(record))).toStrictEqual(records);
  });

  it("parses turn-level reminder and thinking attachments", () => {
    const records = [
      attachmentRecord({ type: "bash_output_audience_note", toolUseID: "toolu_1" }),
      attachmentRecord({
        type: "batching_reminder_sent",
        text: "First privately list what you need next.",
        model: "claude-fable-5-1",
        clearAt: "next_user_message",
      }),
      attachmentRecord({ type: "silent_turn_reminder", text: "Say what you're doing." }),
      attachmentRecord({
        type: "hook_permission_decision",
        decision: "allow",
        toolUseID: "toolu_1",
        hookEvent: "PermissionRequest",
      }),
      attachmentRecord({ type: "thinking_stripped", scope: "all" }),
      attachmentRecord({
        type: "thinking_drop",
        requestId: "req_1",
        model: "claude-opus-5-5",
        querySource: "repl_main_thread",
        thinkingBlocksSent: 15,
        thinkingTurnsSent: 14,
        newlyDropped: {
          blockCount: 15,
          turnCount: 14,
          reason: "prefix_mismatch",
          first: { messageIndex: 2, blockIndex: 0 },
          last: { messageIndex: 87, blockIndex: 1 },
          reasonCounts: { prefix_mismatch: 15 },
        },
        blockHashes: ["2gdd6tokolerh"],
        firstReportForThreadInProcess: false,
        clientChange: {
          kinds: "toolSchemasChanged",
          firstChangedMessageIndex: -1,
          baseline: "memory",
          callNumber: 33,
        },
      }),
    ];

    expect(records.map((record) => JsonlRecordSchema.parse(record))).toStrictEqual(records);
  });

  it("parses new fields on existing attachment types", () => {
    const records = [
      attachmentRecord({ type: "auto_mode", bashFirstSteer: "relaxed" }),
      attachmentRecord({ type: "auto_mode_exit", bashFirst: true, steerOnly: true }),
      attachmentRecord({
        type: "deferred_tools_delta",
        addedNames: ["Edit"],
        wireHiddenNames: [],
        surfacedNames: ["Edit"],
        restoredNames: ["Edit"],
        retractedTools: [{ name: "Edit", cause: "denied" }],
        failedMcpServers: [{ name: "imcp", errorCode: "CONNECT_TIMEOUT", error: "timed out" }],
      }),
      attachmentRecord({
        type: "file",
        filename: "/Users/test/.claude/memory/note.md",
        readNotes: { memoryNote: "This memory is 7 days old." },
      }),
      attachmentRecord({
        type: "task_status",
        taskId: "b80edgxim",
        status: "running",
        shell: { command: "sleep 300", kind: "bash", toolUseId: "toolu_1" },
      }),
      attachmentRecord({
        type: "team_context",
        agentName: "commit-handler",
        hasTaskListTools: false,
      }),
      {
        ...attachmentRecord({
          type: "queued_command",
          prompt: "notification",
          source_uuid: "c42a1d7d-1f5e-421f-84d3-437bde0eadb1",
          humanTurn: true,
          usage: { totalTokens: 83518, toolUses: 3, durationMs: 21780 },
        }),
        renderedInHumanTurn: [{ content: "<system-reminder>\nnotification\n</system-reminder>" }],
      },
    ];

    expect(records.map((record) => JsonlRecordSchema.parse(record))).toStrictEqual(records);
  });
});

describe("parseJsonlRecord", () => {
  it("parses valid JSON and returns typed record", () => {
    const line = JSON.stringify({
      type: "user",
      ...baseFields,
      message: { role: "user", content: "Hello" },
    });
    const result = parseJsonlRecord(line);
    expect(result).not.toBe(null);
    expect(result!.type).toBe("user");
  });

  it("returns null for malformed JSON", () => {
    expect(parseJsonlRecord("not json")).toBe(null);
  });

  it("returns null for empty line", () => {
    expect(parseJsonlRecord("")).toBe(null);
    expect(parseJsonlRecord("   ")).toBe(null);
  });

  it("returns null for unknown record types (strict schema rejects them)", () => {
    const line = JSON.stringify({ type: "unknown-future-type", data: "stuff" });
    const result = parseJsonlRecord(line);
    expect(result).toBe(null);
  });
});

describe("TaskFileSchema", () => {
  it("parses a valid task", () => {
    const task = {
      id: "1",
      subject: "Fix the login bug",
      description: "Auth is broken",
      status: "pending",
      blocks: [],
      blockedBy: [],
    };
    const result = TaskFileSchema.safeParse(task);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.subject).toBe("Fix the login bug");
      expect(result.data.status).toBe("pending");
    }
  });

  it("parses a task with dependencies", () => {
    const task = {
      id: "2",
      subject: "Write tests",
      description: "Add test coverage",
      status: "pending",
      blocks: ["3"],
      blockedBy: ["1"],
      activeForm: "Writing tests",
    };
    const result = TaskFileSchema.safeParse(task);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.blocks).toStrictEqual(["3"]);
      expect(result.data.blockedBy).toStrictEqual(["1"]);
      expect(result.data.activeForm).toBe("Writing tests");
    }
  });

  it("accepts all valid status values", () => {
    for (const status of ["pending", "in_progress", "completed"]) {
      const result = TaskFileSchema.safeParse({
        id: "1",
        subject: "task",
        description: "desc",
        status,
        blocks: [],
        blockedBy: [],
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid status", () => {
    const result = TaskFileSchema.safeParse({
      id: "1",
      subject: "task",
      description: "desc",
      status: "done",
      blocks: [],
      blockedBy: [],
    });
    expect(result.success).toBe(false);
  });

  it("accepts persisted task metadata", () => {
    const result = TaskFileSchema.safeParse({
      id: "1",
      subject: "task",
      description: "desc",
      status: "completed",
      blocks: [],
      blockedBy: [],
      metadata: {
        commit_sha: "769a03b2",
        tests_added: 11,
        verification: { status: "passed" },
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts persisted task owner and metadata", () => {
    const result = TaskFileSchema.safeParse({
      id: "1",
      subject: "task",
      description: "desc",
      status: "pending",
      blocks: [],
      blockedBy: [],
      owner: "agent-1",
      metadata: { priority: "high" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts metadata with arbitrary JSON values", () => {
    const result = TaskFileSchema.safeParse({
      id: "1",
      subject: "task",
      description: "desc",
      status: "pending",
      blocks: [],
      blockedBy: [],
      metadata: { priority: "high" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown fields", () => {
    const result = TaskFileSchema.safeParse({
      id: "1",
      subject: "task",
      description: "desc",
      status: "pending",
      blocks: [],
      blockedBy: [],
      extraField: true,
    });
    expect(result.success).toBe(false);
  });
});

describe("TaskFileSchema against disk", () => {
  const tasksDir = join(homedir(), ".claude", "tasks");

  it("validates all task files on disk", () => {
    let projectDirs: string[];
    try {
      projectDirs = readdirSync(tasksDir);
    } catch {
      return;
    }

    let validated = 0;
    const failures: string[] = [];

    for (const projectDir of projectDirs) {
      const projectPath = join(tasksDir, projectDir);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(projectPath);
      } catch {
        continue;
      }
      if (!st.isDirectory()) continue;

      const files = readdirSync(projectPath).filter((f) => f.endsWith(".json"));
      for (const file of files) {
        const filePath = join(projectPath, file);
        const raw = readFileSync(filePath, "utf-8");
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          failures.push(`${projectDir}/${file}: invalid JSON`);
          continue;
        }

        const result = TaskFileSchema.safeParse(parsed);
        if (!result.success) {
          failures.push(
            `${projectDir}/${file}: ${result.error.issues.map((i) => i.message).join(", ")}`,
          );
        } else {
          validated++;
        }
      }
    }

    if (failures.length > 0) {
      throw new Error(`${failures.length} task files failed validation:\n${failures.join("\n")}`);
    }

    expect(validated).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Per-tool input schemas (Level 3)
// ---------------------------------------------------------------------------

describe("Per-tool input schemas", () => {
  describe("BashInputSchema", () => {
    it("accepts required command field", () => {
      expect(BashInputSchema.safeParse({ command: "ls -la" }).success).toBe(true);
    });

    it("accepts all optional fields", () => {
      const input = {
        command: "npm test",
        description: "Run tests",
        timeout: 30000,
        run_in_background: false,
        dangerouslyDisableSandbox: true,
      };
      expect(BashInputSchema.safeParse(input).success).toBe(true);
    });

    it("rejects unknown fields", () => {
      const result = BashInputSchema.safeParse({
        command: "ls",
        extraField: true,
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing command", () => {
      const result = BashInputSchema.safeParse({ description: "oops" });
      expect(result.success).toBe(false);
    });
  });

  describe("ReadInputSchema", () => {
    it("accepts required file_path", () => {
      expect(ReadInputSchema.safeParse({ file_path: "/foo.ts" }).success).toBe(true);
    });

    it("accepts optional offset, limit, pages", () => {
      const input = {
        file_path: "/foo.ts",
        offset: 10,
        limit: 50,
        pages: "1-5",
      };
      expect(ReadInputSchema.safeParse(input).success).toBe(true);
    });

    it("rejects unknown fields", () => {
      const result = ReadInputSchema.safeParse({
        file_path: "/foo.ts",
        unknown: 1,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("EditInputSchema", () => {
    it("accepts required fields", () => {
      const input = { file_path: "/foo.ts", old_string: "a", new_string: "b" };
      expect(EditInputSchema.safeParse(input).success).toBe(true);
    });

    it("accepts replace_all", () => {
      const input = {
        file_path: "/foo.ts",
        old_string: "a",
        new_string: "b",
        replace_all: true,
      };
      expect(EditInputSchema.safeParse(input).success).toBe(true);
    });
  });

  describe("WriteInputSchema", () => {
    it("accepts required fields", () => {
      const input = { file_path: "/foo.ts", content: "hello" };
      expect(WriteInputSchema.safeParse(input).success).toBe(true);
    });

    it("accepts legacy path/data fields", () => {
      const input = { path: "/foo.ts", data: "hello" };
      expect(WriteInputSchema.safeParse(input).success).toBe(true);
    });

    it("accepts path/content fields from historical transcripts", () => {
      const input = { path: "/foo.ts", content: "hello" };
      expect(WriteInputSchema.safeParse(input).success).toBe(true);
    });

    it("rejects incomplete write fields", () => {
      expect(WriteInputSchema.safeParse({ file_path: "/foo.ts" }).success).toBe(false);
      expect(WriteInputSchema.safeParse({ path: "/foo.ts" }).success).toBe(false);
    });
  });

  describe("GlobInputSchema", () => {
    it("accepts pattern with optional path", () => {
      expect(GlobInputSchema.safeParse({ pattern: "**/*.ts" }).success).toBe(true);
      expect(GlobInputSchema.safeParse({ pattern: "**/*.ts", path: "/src" }).success).toBe(true);
    });
  });

  describe("GrepInputSchema", () => {
    it("accepts pattern with all optional fields", () => {
      const input = {
        pattern: "foo",
        path: "/src",
        glob: "*.ts",
        type: "ts",
        "-i": true,
        output_mode: "content",
        "-A": 3,
        "-B": 3,
        "-C": 5,
        "-n": true,
        head_limit: 100,
        offset: 10,
        multiline: false,
        context: 2,
      };
      expect(GrepInputSchema.safeParse(input).success).toBe(true);
    });
  });

  describe("AgentInputSchema", () => {
    it("accepts required prompt", () => {
      expect(AgentInputSchema.safeParse({ prompt: "Do something" }).success).toBe(true);
    });

    it("accepts all optional fields", () => {
      const input = {
        prompt: "Do something",
        description: "Test agent",
        subagent_type: "Code",
        isolation: "full",
        mode: "plan",
        model: "sonnet",
        effort: "high",
        name: "my-agent",
        run_in_background: true,
        team_name: "alpha",
      };
      expect(AgentInputSchema.safeParse(input).success).toBe(true);
    });
  });

  describe("task tool schemas", () => {
    it("accepts TaskCreate input without a subject", () => {
      const schema = toolInputSchemas["TaskCreate"];
      if (!schema) throw new Error("Missing TaskCreate input schema");
      const result = schema.safeParse({
        description: "Create an example task",
        activeForm: "Creating an example task",
      });
      expect(result.success).toBe(true);
    });

    it("accepts TaskGet input with id", () => {
      const schema = toolInputSchemas["TaskGet"];
      if (!schema) throw new Error("Missing TaskGet input schema");
      const result = schema.safeParse({ id: "task-100" });
      expect(result.success).toBe(true);
    });
  });

  it("registry covers all known tools", () => {
    const expectedTools = [
      "Bash",
      "Read",
      "Edit",
      "MultiEdit",
      "Write",
      "Glob",
      "Grep",
      "Agent",
      "WebFetch",
      "Skill",
      "TaskCreate",
      "TaskUpdate",
      "TaskGet",
      "TaskList",
      "AskUserQuestion",
      "ExitPlanMode",
      "ToolSearch",
    ];
    for (const tool of expectedTools) {
      if (!toolInputSchemas[tool as keyof typeof toolInputSchemas]) {
        throw new Error(`Missing schema for tool: ${tool}`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// ContentBlockSchema superRefine validates tool inputs
// ---------------------------------------------------------------------------

describe("ContentBlockSchema tool input validation", () => {
  it("validates known tool input via superRefine", () => {
    const block = {
      type: "tool_use",
      id: "tu_1",
      name: "Read",
      input: { file_path: "/foo.ts" },
    };
    const result = ContentBlockSchema.safeParse(block);
    expect(result.success).toBe(true);
  });

  it("accepts unknown tool names without validation", () => {
    const block = {
      type: "tool_use",
      id: "tu_1",
      name: "NonExistentTool",
      input: {},
    };
    const result = ContentBlockSchema.safeParse(block);
    expect(result.success).toBe(true);
  });

  it("rejects invalid input for known tools", () => {
    const block = {
      type: "tool_use",
      id: "tu_1",
      name: "Bash",
      input: { notACommand: "oops" },
    };
    const result = ContentBlockSchema.safeParse(block);
    expect(result.success).toBe(false);
  });

  it("accepts TaskCreate metadata objects", () => {
    const block = {
      type: "tool_use",
      id: "tu_1",
      name: "TaskCreate",
      input: {
        subject: "Ship the feature",
        metadata: {
          commit_sha: "769a03b2",
          test_pass_rate: "100%",
        },
      },
    };
    const result = ContentBlockSchema.safeParse(block);
    expect(result.success).toBe(true);
  });

  it("accepts TaskCreate inputs without subjects", () => {
    const block = {
      type: "tool_use",
      id: "tu_1",
      name: "TaskCreate",
      input: {
        description: "Create the next task from context",
      },
    };
    const result = ContentBlockSchema.safeParse(block);
    expect(result.success).toBe(true);
  });

  it("accepts TaskUpdate metadata objects and strings", () => {
    const objectMetadataBlock = {
      type: "tool_use",
      id: "tu_1",
      name: "TaskUpdate",
      input: {
        taskId: "1",
        status: "completed",
        metadata: {
          commit_sha: "dd9b3c9f7514fdec89f64be11f1a254c92d11c42",
          tests_added: 11,
        },
      },
    };
    const stringMetadataBlock = {
      type: "tool_use",
      id: "tu_2",
      name: "TaskUpdate",
      input: {
        taskId: "1",
        status: "completed",
        metadata: '{"precommit_checks":"15/15 passed"}',
      },
    };
    expect(ContentBlockSchema.safeParse(objectMetadataBlock).success).toBe(true);
    expect(ContentBlockSchema.safeParse(stringMetadataBlock).success).toBe(true);
  });

  it("accepts historical TaskUpdate id input", () => {
    const block = {
      type: "tool_use",
      id: "tu_1",
      name: "TaskUpdate",
      input: {
        id: 6,
        status: "completed",
        addBlocks: ["100", "200"],
      },
    };

    expect(ContentBlockSchema.parse(block)).toStrictEqual(block);
  });

  it("accepts TaskGet id input", () => {
    const block = {
      type: "tool_use",
      id: "tool-task-get-100",
      name: "TaskGet",
      input: {
        id: "100",
      },
    };
    expect(ContentBlockSchema.safeParse(block).success).toBe(true);
  });

  it("rejects extra input fields for known tools", () => {
    const block = {
      type: "tool_use",
      id: "tu_1",
      name: "Read",
      input: { file_path: "/foo.ts", extraField: "nope" },
    };
    const result = ContentBlockSchema.safeParse(block);
    expect(result.success).toBe(false);
  });

  it("allows MCP tools without strict input validation", () => {
    const block = {
      type: "tool_use",
      id: "tu_1",
      name: "mcp__plugin_github_github__list_issues",
      input: { owner: "foo", repo: "bar", anythingGoes: true },
    };
    const result = ContentBlockSchema.safeParse(block);
    expect(result.success).toBe(true);
  });

  it("does not validate non-tool_use blocks", () => {
    const block = { type: "text", text: "hello" };
    const result = ContentBlockSchema.safeParse(block);
    expect(result.success).toBe(true);
  });
});
