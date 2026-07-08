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
    };
    const result = UserRecordSchema.safeParse(record);
    expect(result.success).toBe(true);
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
      message: {
        ...assistantMessageFields,
        content: [{ type: "text", text: "Hi" }],
      },
    };
    const result = AssistantRecordSchema.safeParse(record);
    expect(result.success).toBe(true);
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
    };
    const result = SystemRecordSchema.safeParse(record);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.subtype).toBe("turn_duration");
    }
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
      sessionId: "sess-123",
    };
    const result = LastPromptRecordSchema.safeParse(record);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lastPrompt).toBe("Fix the login bug");
    }
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

  it("parses auto mode attachments with consent flow metadata", () => {
    const record = {
      type: "attachment",
      attachment: {
        type: "auto_mode",
        autoModeConsentFlow: false,
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

  it("parses relocated records", () => {
    const result = JsonlRecordSchema.safeParse({
      type: "relocated",
      sessionId: "session-100",
      relocatedCwd: "/tmp/test/worktree",
    });
    expect(result.success).toBe(true);
  });

  it("parses worktree state with the pre-entry directory", () => {
    const result = JsonlRecordSchema.safeParse({
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
    });
    expect(result.success).toBe(true);
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
      if (!toolInputSchemas[tool]) throw new Error(`Missing schema for tool: ${tool}`);
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
