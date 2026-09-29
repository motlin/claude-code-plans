import { describe, it, expect } from "vite-plus/test";
import { processTranscript, processNewRecords } from "../src/lib/transcript";
import {
  extractToolResultContent,
  stripResultTags,
  truncateResult,
  stripCommandTags,
  extractSessionTitle,
} from "../src/lib/session-utils";

// ---------------------------------------------------------------------------
// Helper: build a minimal JSONL record
// ---------------------------------------------------------------------------

function userRecord(
  content: unknown,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { type: "user", message: { role: "user", content }, ...extra };
}

function assistantRecord(
  content: unknown,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    type: "assistant",
    message: { role: "assistant", content },
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// processTranscript
// ---------------------------------------------------------------------------

describe("processTranscript", () => {
  it("returns empty results for empty input", () => {
    const result = processTranscript([]);
    expect(result.lines).toStrictEqual([]);
    expect(result.toolResultMap.size).toBe(0);
    expect(result.uuidToLine.size).toBe(0);
    expect(result.title).toBe("");
    expect(result.customTitle).toBeUndefined();
  });

  it("includes user and assistant lines with lineIndex", () => {
    const records = [
      userRecord([{ type: "text", text: "Hello" }], {
        uuid: "u-1",
        timestamp: "1999-12-31T00:00:00Z",
      }),
      assistantRecord([{ type: "text", text: "Hi" }], {
        uuid: "a-1",
        timestamp: "1999-12-31T00:01:00Z",
      }),
    ];
    const result = processTranscript(records);
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]!.type).toBe("user");
    expect(result.lines[0]!.lineIndex).toBe(0);
    expect(result.lines[1]!.type).toBe("assistant");
    expect(result.lines[1]!.lineIndex).toBe(1);
  });

  it("normalizes snake_case session identifiers for rendered lines", () => {
    const result = processTranscript([
      userRecord("Hello", {
        uuid: "u-1",
        session_id: "record-session",
      }),
    ]);

    expect(result.lines).toStrictEqual([
      {
        type: "user",
        uuid: "u-1",
        sessionId: "record-session",
        message: {
          role: "user",
          content: "Hello",
        },
        lineIndex: 0,
      },
    ]);
  });

  it("filters out non-rendering record types", () => {
    const records = [
      { type: "system", uuid: "sys-1", timestamp: "1999-12-31T00:00:00Z" },
      { type: "progress", uuid: "prog-1" },
      { type: "file-history-snapshot", snapshot: { trackedFileBackups: {} } },
    ];
    const result = processTranscript(records);
    expect(result.lines).toStrictEqual([]);
  });

  it("extracts title from first user text", () => {
    const records = [
      userRecord([{ type: "text", text: "Fix the login page" }], {
        uuid: "u-1",
      }),
      assistantRecord([{ type: "text", text: "Done" }], { uuid: "a-1" }),
    ];
    const result = processTranscript(records);
    expect(result.title).toBe("Fix the login page");
  });

  it("extracts customTitle from custom-title records", () => {
    const records = [
      {
        type: "custom-title",
        customTitle: "My Custom Title",
        sessionId: "s-1",
      },
      userRecord([{ type: "text", text: "Hello" }], { uuid: "u-1" }),
    ];
    const result = processTranscript(records);
    expect(result.customTitle).toBe("My Custom Title");
  });

  it("builds uuidToLine mapping", () => {
    const records = [
      userRecord([{ type: "text", text: "Hello" }], { uuid: "u-1" }),
      assistantRecord([{ type: "text", text: "Hi" }], { uuid: "a-1" }),
    ];
    const result = processTranscript(records);
    expect(result.uuidToLine.get("u-1")).toBe(0);
    expect(result.uuidToLine.get("a-1")).toBe(1);
  });

  it("pairs tool_use with tool_result and computes duration", () => {
    const records = [
      assistantRecord(
        [
          {
            type: "tool_use",
            id: "tool-1",
            name: "Bash",
            input: { command: "ls" },
          },
        ],
        {
          uuid: "a-1",
          timestamp: "1999-12-31T00:00:00.000Z",
        },
      ),
      userRecord(
        [
          {
            type: "tool_result",
            tool_use_id: "tool-1",
            content: "file1.txt\nfile2.txt",
          },
        ],
        {
          uuid: "u-1",
          timestamp: "1999-12-31T00:00:05.000Z",
        },
      ),
    ];
    const result = processTranscript(records);
    expect(result.toolResultMap.size).toBe(1);
    const toolResult = result.toolResultMap.get("tool-1");
    expect(toolResult).toStrictEqual({
      result: "file1.txt\nfile2.txt",
      isError: false,
      resultUuid: "u-1",
      duration: 5000,
    });
  });

  it("marks error tool results", () => {
    const records = [
      assistantRecord(
        [
          {
            type: "tool_use",
            id: "tool-1",
            name: "Bash",
            input: { command: "fail" },
          },
        ],
        {
          uuid: "a-1",
          timestamp: "1999-12-31T00:00:00Z",
        },
      ),
      userRecord(
        [
          {
            type: "tool_result",
            tool_use_id: "tool-1",
            content: "error msg",
            is_error: true,
          },
        ],
        {
          uuid: "u-1",
          timestamp: "1999-12-31T00:00:01Z",
        },
      ),
    ];
    const result = processTranscript(records);
    expect(result.toolResultMap.get("tool-1")!.isError).toBe(true);
  });

  it("strips system-reminder tags from tool results", () => {
    const records = [
      assistantRecord(
        [
          {
            type: "tool_use",
            id: "tool-1",
            name: "Bash",
            input: { command: "echo hi" },
          },
        ],
        {
          uuid: "a-1",
          timestamp: "1999-12-31T00:00:00Z",
        },
      ),
      userRecord(
        [
          {
            type: "tool_result",
            tool_use_id: "tool-1",
            content: "output<system-reminder>hidden</system-reminder>",
          },
        ],
        { uuid: "u-1", timestamp: "1999-12-31T00:00:01Z" },
      ),
    ];
    const result = processTranscript(records);
    expect(result.toolResultMap.get("tool-1")!.result).toBe("output");
  });

  it("truncates long tool results", () => {
    const longContent = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
    const records = [
      assistantRecord(
        [
          {
            type: "tool_use",
            id: "tool-1",
            name: "Bash",
            input: { command: "cat big" },
          },
        ],
        {
          uuid: "a-1",
          timestamp: "1999-12-31T00:00:00Z",
        },
      ),
      userRecord([{ type: "tool_result", tool_use_id: "tool-1", content: longContent }], {
        uuid: "u-1",
        timestamp: "1999-12-31T00:00:01Z",
      }),
    ];
    const result = processTranscript(records);
    const resultText = result.toolResultMap.get("tool-1")!.result;
    const resultLines = resultText.split("\n");
    expect(resultLines.length).toBeLessThanOrEqual(151);
    expect(resultLines[resultLines.length - 1]).toMatch(/\d+ more lines/);
  });

  it("handles tool_result with array content blocks", () => {
    const records = [
      assistantRecord(
        [
          {
            type: "tool_use",
            id: "tool-1",
            name: "Read",
            input: { file_path: "/tmp/f" },
          },
        ],
        {
          uuid: "a-1",
          timestamp: "1999-12-31T00:00:00Z",
        },
      ),
      userRecord(
        [
          {
            type: "tool_result",
            tool_use_id: "tool-1",
            content: [
              { type: "text", text: "line1" },
              { type: "text", text: "line2" },
            ],
          },
        ],
        { uuid: "u-1", timestamp: "1999-12-31T00:00:01Z" },
      ),
    ];
    const result = processTranscript(records);
    expect(result.toolResultMap.get("tool-1")!.result).toBe("line1\nline2");
  });

  it("includes agent-name lines", () => {
    const records = [{ type: "agent-name", agentName: "test-agent", sessionId: "s-1" }];
    const result = processTranscript(records);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toStrictEqual({
      type: "agent-name",
      agentName: "test-agent",
      lineIndex: 0,
    });
  });

  it("includes agent-color lines", () => {
    const records = [{ type: "agent-color", agentColor: "#ff0000", sessionId: "s-1" }];
    const result = processTranscript(records);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toStrictEqual({
      type: "agent-color",
      agentColor: "#ff0000",
      lineIndex: 0,
    });
  });

  it("includes permission-mode lines", () => {
    const records = [
      {
        type: "permission-mode",
        permissionMode: "auto-accept",
        sessionId: "s-1",
      },
    ];
    const result = processTranscript(records);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toStrictEqual({
      type: "permission-mode",
      permissionMode: "auto-accept",
      lineIndex: 0,
    });
  });

  it("includes pr-link lines", () => {
    const records = [
      {
        type: "pr-link",
        prUrl: "https://github.com/org/repo/pull/42",
        prNumber: 42,
        prRepository: "org/repo",
        sessionId: "s-1",
        timestamp: "1999-12-31T00:00:00Z",
      },
    ];
    const result = processTranscript(records);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toStrictEqual({
      type: "pr-link",
      prUrl: "https://github.com/org/repo/pull/42",
      prNumber: 42,
      prRepository: "org/repo",
      timestamp: "1999-12-31T00:00:00Z",
      lineIndex: 0,
    });
  });

  it("includes attachment lines", () => {
    const records = [
      {
        type: "attachment",
        uuid: "att-1",
        timestamp: "1999-12-31T00:00:00Z",
        attachment: { type: "plan_mode", planFilePath: "/tmp/plan.md" },
      },
    ];
    const result = processTranscript(records);
    expect(result.lines).toHaveLength(1);
    const line = result.lines[0]!;
    expect(line.type).toBe("attachment");
    if (line.type === "attachment") {
      expect(JSON.parse(line.attachmentJson)).toStrictEqual({
        type: "plan_mode",
        planFilePath: "/tmp/plan.md",
      });
      expect(line.uuid).toBe("att-1");
      expect(line.timestamp).toBe("1999-12-31T00:00:00Z");
    }
  });

  it("carries rendered attachment context onto attachment lines", () => {
    const records = [
      {
        type: "attachment",
        uuid: "att-2",
        timestamp: "1999-12-31T00:00:00Z",
        sessionId: "s-1",
        attachment: { type: "silent_turn_reminder" },
        rendered: [{ content: "<system-reminder>quiet</system-reminder>" }],
        renderedInHumanTurn: [{ content: "quiet" }],
        renderedRole: "user",
      },
    ];
    const result = processTranscript(records);
    expect(result.lines).toStrictEqual([
      {
        type: "attachment",
        attachmentJson: JSON.stringify({ type: "silent_turn_reminder" }),
        rendered: ["<system-reminder>quiet</system-reminder>"],
        renderedInHumanTurn: ["quiet"],
        renderedRole: "user",
        uuid: "att-2",
        timestamp: "1999-12-31T00:00:00Z",
        sessionId: "s-1",
        lineIndex: 0,
      },
    ]);
  });

  describe("queued commands absorbed mid-turn", () => {
    const absorbedRemove = {
      type: "queue-operation",
      operation: "remove",
      timestamp: "1999-12-31T00:00:01Z",
      sessionId: "s-1",
      content: "also check the tests",
      reason: "absorbed_mid_turn",
      commandUuid: "cmd-1",
    };
    const queuedAttachment = {
      type: "attachment",
      uuid: "att-q",
      timestamp: "1999-12-31T00:00:02Z",
      sessionId: "s-1",
      attachment: {
        type: "queued_command",
        prompt: "also check the tests",
        source_uuid: "cmd-1",
      },
    };
    const expectedLine = (lineIndex: number) => ({
      type: "attachment",
      attachmentJson: JSON.stringify(queuedAttachment.attachment),
      absorbedMidTurn: true,
      uuid: "att-q",
      timestamp: "1999-12-31T00:00:02Z",
      sessionId: "s-1",
      lineIndex,
    });

    it("marks the queued command an earlier absorbed removal points at", () => {
      expect(processTranscript([absorbedRemove, queuedAttachment]).lines).toStrictEqual([
        expectedLine(1),
      ]);
    });

    it("marks the queued command when the absorbed removal is written after it", () => {
      expect(processTranscript([queuedAttachment, absorbedRemove]).lines).toStrictEqual([
        expectedLine(0),
      ]);
    });

    it("leaves queued commands unmarked for other removals or other commands", () => {
      const records = [
        { ...absorbedRemove, reason: "cancelled" },
        { ...absorbedRemove, commandUuid: "cmd-other" },
        queuedAttachment,
      ];
      expect(processTranscript(records).lines).toStrictEqual([
        {
          type: "attachment",
          attachmentJson: JSON.stringify(queuedAttachment.attachment),
          uuid: "att-q",
          timestamp: "1999-12-31T00:00:02Z",
          sessionId: "s-1",
          lineIndex: 2,
        },
      ]);
    });
  });

  it("preserves parentUuid on message lines", () => {
    const records = [
      assistantRecord([{ type: "text", text: "response" }], {
        uuid: "a-1",
        parentUuid: "u-0",
      }),
    ];
    const result = processTranscript(records);
    const line = result.lines[0]!;
    if (line.type === "assistant") {
      expect(line.parentUuid).toBe("u-0");
    }
  });

  it("preserves userType on message lines", () => {
    const records = [
      userRecord([{ type: "text", text: "automated prompt" }], {
        uuid: "u-1",
        userType: "external",
      }),
      assistantRecord([{ type: "text", text: "response" }], { uuid: "a-1" }),
    ];
    const result = processTranscript(records);
    const userLine = result.lines[0]!;
    expect(userLine.type).toBe("user");
    if (userLine.type === "user") {
      expect(userLine.userType).toBe("external");
    }
    const assistantLine = result.lines[1]!;
    expect(assistantLine.type).toBe("assistant");
    if (assistantLine.type === "assistant") {
      expect(assistantLine.userType).toBeUndefined();
    }
  });

  it("omits userType when not present on record", () => {
    const records = [userRecord([{ type: "text", text: "Hello" }], { uuid: "u-1" })];
    const result = processTranscript(records);
    const line = result.lines[0]!;
    if (line.type === "user") {
      expect(line.userType).toBeUndefined();
    }
  });

  it("preserves isMeta on user message lines when true", () => {
    const records = [
      userRecord([{ type: "text", text: "Stop hook feedback: ..." }], {
        uuid: "u-1",
        isMeta: true,
      }),
    ];
    const result = processTranscript(records);
    const line = result.lines[0]!;
    expect(line.type).toBe("user");
    if (line.type === "user") {
      expect(line.isMeta).toBe(true);
    }
  });

  it("omits isMeta when not present on record", () => {
    const records = [userRecord([{ type: "text", text: "Hello" }], { uuid: "u-1" })];
    const result = processTranscript(records);
    const line = result.lines[0]!;
    if (line.type === "user") {
      expect(line.isMeta).toBeUndefined();
    }
  });

  it("preserves isCompactSummary on user message lines when true", () => {
    const records = [
      userRecord(
        [
          {
            type: "text",
            text: "This session is being continued from a previous conversation...",
          },
        ],
        {
          uuid: "u-1",
          isCompactSummary: true,
        },
      ),
    ];
    const result = processTranscript(records);
    const line = result.lines[0]!;
    expect(line.type).toBe("user");
    if (line.type === "user") {
      expect(line.isCompactSummary).toBe(true);
    }
  });

  it("omits isCompactSummary when not present on record", () => {
    const records = [userRecord([{ type: "text", text: "Hello" }], { uuid: "u-1" })];
    const result = processTranscript(records);
    const line = result.lines[0]!;
    if (line.type === "user") {
      expect(line.isCompactSummary).toBeUndefined();
    }
  });

  it("preserves isVisibleInTranscriptOnly on user message lines when true", () => {
    const records = [
      userRecord([{ type: "text", text: "Hidden message" }], {
        uuid: "u-1",
        isVisibleInTranscriptOnly: true,
      }),
    ];
    const result = processTranscript(records);
    const line = result.lines[0]!;
    expect(line.type).toBe("user");
    if (line.type === "user") {
      expect(line.isVisibleInTranscriptOnly).toBe(true);
    }
  });

  it("omits isVisibleInTranscriptOnly when not present on record", () => {
    const records = [userRecord([{ type: "text", text: "Hello" }], { uuid: "u-1" })];
    const result = processTranscript(records);
    const line = result.lines[0]!;
    if (line.type === "user") {
      expect(line.isVisibleInTranscriptOnly).toBeUndefined();
    }
  });

  it("handles user records with string content", () => {
    const records = [userRecord("simple text", { uuid: "u-1" })];
    const result = processTranscript(records);
    expect(result.lines).toHaveLength(1);
    expect(result.title).toBe("simple text");
  });

  it("surfaces malformed records without dropping the records around them", () => {
    const records = [
      { type: "unknown-type-42" },
      userRecord([{ type: "text", text: "Hello" }], { uuid: "u-1" }),
    ];
    const result = processTranscript(records);
    expect(result.lines.map((line) => line.type)).toStrictEqual(["unparsed", "user"]);
  });

  it("parses subagent records that contain agentId field", () => {
    const records = [
      userRecord([{ type: "text", text: "subagent prompt" }], {
        uuid: "u-1",
        agentId: "agent-abc123",
      }),
      assistantRecord([{ type: "text", text: "subagent response" }], {
        uuid: "a-1",
        agentId: "agent-abc123",
      }),
    ];
    const result = processTranscript(records);
    expect(result.lines).toHaveLength(2);
    expect(result.title).toBe("subagent prompt");
  });

  it("parses tool_use blocks with unknown tool names", () => {
    const records = [
      assistantRecord(
        [
          {
            type: "tool_use",
            id: "tool-1",
            name: "bash",
            input: { command: "ls" },
          },
        ],
        {
          uuid: "a-1",
          timestamp: "1999-12-31T00:00:00Z",
        },
      ),
      userRecord([{ type: "tool_result", tool_use_id: "tool-1", content: "output" }], {
        uuid: "u-1",
        timestamp: "1999-12-31T00:00:01Z",
      }),
    ];
    const result = processTranscript(records);
    expect(result.lines).toHaveLength(2);
    expect(result.toolResultMap.size).toBe(1);
  });

  it("deduplicates consecutive identical slash command messages", () => {
    const commandContent =
      "<command-name>/chrome</command-name>\n<command-message>chrome</command-message>\n<command-args></command-args>";
    const caveatContent =
      "<local-command-caveat>Caveat: The messages below were generated by the user while running local commands.</local-command-caveat>";
    const stdoutContent = "<local-command-stdout>(no content)</local-command-stdout>";
    const records = [
      userRecord(caveatContent),
      userRecord(commandContent, { uuid: "cmd-1" }),
      userRecord(stdoutContent),
      userRecord(caveatContent),
      userRecord(commandContent, { uuid: "cmd-2" }),
      userRecord(stdoutContent),
    ];
    const result = processTranscript(records);
    // Only one command group should appear: caveat + command + stdout
    const commandLines = result.lines.filter(
      (l) =>
        l.type === "user" &&
        "message" in l &&
        typeof l.message?.content === "string" &&
        l.message.content.includes("<command-name>"),
    );
    expect(commandLines).toHaveLength(1);
  });

  it("keeps non-consecutive identical slash commands", () => {
    const commandContent =
      "<command-name>/chrome</command-name>\n<command-message>chrome</command-message>\n<command-args></command-args>";
    const records = [
      userRecord(commandContent, { uuid: "cmd-1" }),
      userRecord([{ type: "text", text: "regular user message" }], {
        uuid: "u-1",
      }),
      assistantRecord([{ type: "text", text: "response" }], { uuid: "a-1" }),
      userRecord(commandContent, { uuid: "cmd-2" }),
    ];
    const result = processTranscript(records);
    const commandLines = result.lines.filter(
      (l) =>
        l.type === "user" &&
        "message" in l &&
        typeof l.message?.content === "string" &&
        l.message.content.includes("<command-name>"),
    );
    expect(commandLines).toHaveLength(2);
  });

  it("keeps consecutive different slash commands", () => {
    const chromeCommand =
      "<command-name>/chrome</command-name>\n<command-message>chrome</command-message>\n<command-args></command-args>";
    const compactCommand =
      "<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args></command-args>";
    const records = [
      userRecord(chromeCommand, { uuid: "cmd-1" }),
      userRecord(compactCommand, { uuid: "cmd-2" }),
    ];
    const result = processTranscript(records);
    const commandLines = result.lines.filter(
      (l) =>
        l.type === "user" &&
        "message" in l &&
        typeof l.message?.content === "string" &&
        l.message.content.includes("<command-name>"),
    );
    expect(commandLines).toHaveLength(2);
  });

  it("deduplicates command groups separated by a blank assistant message", () => {
    const commandContent =
      "<command-name>/chrome</command-name>\n<command-message>chrome</command-message>\n<command-args></command-args>";
    const caveatContent =
      "<local-command-caveat>Caveat: The messages below were generated by the user while running local commands.</local-command-caveat>";
    const stdoutContent = "<local-command-stdout>(no content)</local-command-stdout>";
    const records = [
      userRecord(caveatContent),
      userRecord(commandContent, { uuid: "cmd-1" }),
      userRecord(stdoutContent),
      assistantRecord([], { uuid: "a-blank" }),
      userRecord(caveatContent),
      userRecord(commandContent, { uuid: "cmd-2" }),
      userRecord(stdoutContent),
    ];
    const result = processTranscript(records);
    const commandLines = result.lines.filter(
      (l) =>
        l.type === "user" &&
        "message" in l &&
        typeof l.message?.content === "string" &&
        l.message.content.includes("<command-name>"),
    );
    expect(commandLines).toHaveLength(1);
    // The blank assistant message should also be removed
    const assistantLines = result.lines.filter((l) => l.type === "assistant");
    expect(assistantLines).toHaveLength(0);
  });

  it("deduplicates command groups separated by an empty-string assistant message", () => {
    const commandContent =
      "<command-name>/chrome</command-name>\n<command-message>chrome</command-message>\n<command-args></command-args>";
    const records = [
      userRecord(commandContent, { uuid: "cmd-1" }),
      assistantRecord("", { uuid: "a-blank" }),
      userRecord(commandContent, { uuid: "cmd-2" }),
    ];
    const result = processTranscript(records);
    const commandLines = result.lines.filter(
      (l) =>
        l.type === "user" &&
        "message" in l &&
        typeof l.message?.content === "string" &&
        l.message.content.includes("<command-name>"),
    );
    expect(commandLines).toHaveLength(1);
  });

  it("keeps commands separated by a non-blank assistant message", () => {
    const commandContent =
      "<command-name>/chrome</command-name>\n<command-message>chrome</command-message>\n<command-args></command-args>";
    const records = [
      userRecord(commandContent, { uuid: "cmd-1" }),
      assistantRecord([{ type: "text", text: "Connecting to Chrome..." }], {
        uuid: "a-1",
      }),
      userRecord(commandContent, { uuid: "cmd-2" }),
    ];
    const result = processTranscript(records);
    const commandLines = result.lines.filter(
      (l) =>
        l.type === "user" &&
        "message" in l &&
        typeof l.message?.content === "string" &&
        l.message.content.includes("<command-name>"),
    );
    expect(commandLines).toHaveLength(2);
  });

  it("deduplicates command group including caveat and stdout lines", () => {
    const commandContent =
      "<command-name>/chrome</command-name>\n<command-message>chrome</command-message>\n<command-args></command-args>";
    const caveatContent =
      "<local-command-caveat>Caveat: The messages below were generated by the user while running local commands.</local-command-caveat>";
    const stdoutContent = "<local-command-stdout>(no content)</local-command-stdout>";
    const records = [
      userRecord(caveatContent),
      userRecord(commandContent, { uuid: "cmd-1" }),
      userRecord(stdoutContent),
      userRecord(caveatContent),
      userRecord(commandContent, { uuid: "cmd-2" }),
      userRecord(stdoutContent),
      userRecord([{ type: "text", text: "is it connected?" }], { uuid: "u-1" }),
    ];
    const result = processTranscript(records);
    // Should have: caveat + command + stdout + "is it connected?" = 4 lines
    // The duplicate caveat + command + stdout group (3 lines) should be removed
    const userLines = result.lines.filter((l) => l.type === "user");
    expect(userLines).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// processNewRecords
// ---------------------------------------------------------------------------

describe("processNewRecords", () => {
  it("returns empty results for empty input", () => {
    const result = processNewRecords([], 0);
    expect(result.newSessionLines).toStrictEqual([]);
    expect(result.newToolResults.size).toBe(0);
  });

  it("applies startIndex offset to lineIndex", () => {
    const records = [userRecord([{ type: "text", text: "Hello" }], { uuid: "u-1" })];
    const result = processNewRecords(records, 5);
    expect(result.newSessionLines[0]!.lineIndex).toBe(5);
  });

  it("pairs tool_use with tool_result in incremental batch", () => {
    const records = [
      assistantRecord(
        [
          {
            type: "tool_use",
            id: "tool-1",
            name: "Bash",
            input: { command: "ls" },
          },
        ],
        {
          uuid: "a-1",
          timestamp: "1999-12-31T00:00:00.000Z",
        },
      ),
      userRecord([{ type: "tool_result", tool_use_id: "tool-1", content: "output" }], {
        uuid: "u-1",
        timestamp: "1999-12-31T00:00:03.000Z",
      }),
    ];
    const result = processNewRecords(records, 10);
    expect(result.newToolResults.size).toBe(1);
    expect(result.newToolResults.get("tool-1")!.duration).toBe(3000);
  });

  it("filters non-rendering record types", () => {
    const records = [
      { type: "system", uuid: "sys-1" },
      { type: "progress", uuid: "prog-1" },
    ];
    const result = processNewRecords(records, 0);
    expect(result.newSessionLines).toStrictEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Shared helpers (moved from session-utils.ts)
// ---------------------------------------------------------------------------

describe("extractToolResultContent", () => {
  it("returns string content directly", () => {
    expect(extractToolResultContent("hello")).toBe("hello");
  });

  it("concatenates text blocks from array content", () => {
    const content = [
      { type: "text", text: "a" },
      { type: "text", text: "b" },
    ];
    expect(extractToolResultContent(content)).toBe("a\nb");
  });

  it("returns undefined for non-text array", () => {
    expect(extractToolResultContent([{ type: "image" }])).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(extractToolResultContent(undefined)).toBeUndefined();
  });
});

describe("stripResultTags", () => {
  it("strips system-reminder tags", () => {
    expect(stripResultTags("output<system-reminder>hidden</system-reminder>")).toBe("output");
  });

  it("strips tool_use_error tags", () => {
    expect(stripResultTags("<tool_use_error>error</tool_use_error>")).toBe("error");
  });

  it("strips persisted-output tags", () => {
    expect(stripResultTags("<persisted-output>data</persisted-output>")).toBe("data");
  });

  it("returns unchanged text when no tags present", () => {
    expect(stripResultTags("no tags here")).toBe("no tags here");
  });
});

describe("truncateResult", () => {
  it("returns short text unchanged", () => {
    expect(truncateResult("short", 10)).toBe("short");
  });

  it("truncates long text with line count", () => {
    const text = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const result = truncateResult(text, 5);
    const lines = result.split("\n");
    expect(lines).toHaveLength(6);
    expect(lines[5]).toMatch(/15 more lines/);
  });
});

describe("stripCommandTags", () => {
  it("strips command tags from text", () => {
    expect(stripCommandTags("<command-message>hello</command-message>")).toBe("hello");
  });

  it("returns plain text unchanged", () => {
    expect(stripCommandTags("plain text")).toBe("plain text");
  });
});

describe("extractSessionTitle", () => {
  it("returns short text directly", () => {
    expect(extractSessionTitle("Fix the bug")).toBe("Fix the bug");
  });

  it("truncates long text with ellipsis", () => {
    const longText = "A".repeat(100);
    const result = extractSessionTitle(longText);
    expect(result.length).toBeLessThan(100);
    expect(result.endsWith("...")).toBe(true);
  });

  it("returns fallback for empty text", () => {
    expect(extractSessionTitle("", "fallback")).toBe("fallback");
  });

  it("returns Untitled Session for empty text with no fallback", () => {
    expect(extractSessionTitle("")).toBe("Untitled Session");
  });
});

// ---------------------------------------------------------------------------
// Message metadata fields (promptSource, API errors, usage, attribution)
// ---------------------------------------------------------------------------

describe("message metadata fields", () => {
  it("carries non-human turnOrigin and scheduledTaskId on user lines", () => {
    const records = [
      userRecord("from a peer", { turnOrigin: "peer" }),
      userRecord("/loop check", { turnOrigin: "scheduled", scheduledTaskId: "e283ee16" }),
      userRecord("typed by a human", { turnOrigin: "human" }),
    ];
    expect(processTranscript(records).lines).toStrictEqual([
      {
        type: "user",
        lineIndex: 0,
        turnOrigin: "peer",
        message: { role: "user", content: "from a peer" },
      },
      {
        type: "user",
        lineIndex: 1,
        turnOrigin: "scheduled",
        scheduledTaskId: "e283ee16",
        message: { role: "user", content: "/loop check" },
      },
      {
        type: "user",
        lineIndex: 2,
        message: { role: "user", content: "typed by a human" },
      },
    ]);
  });

  it("carries promptSource and queuePriority on user lines except typed prompt sources", () => {
    const records = [
      userRecord("Background agents were stopped by the user.", {
        promptSource: "system",
        queuePriority: "later",
      }),
      userRecord("typed prompt", { promptSource: "typed" }),
      userRecord("plain prompt"),
    ];
    const result = processTranscript(records);
    expect(result.lines).toStrictEqual([
      {
        type: "user",
        lineIndex: 0,
        promptSource: "system",
        queuePriority: "later",
        message: {
          role: "user",
          content: "Background agents were stopped by the user.",
        },
      },
      {
        type: "user",
        lineIndex: 1,
        message: {
          role: "user",
          content: "typed prompt",
        },
      },
      {
        type: "user",
        lineIndex: 2,
        message: {
          role: "user",
          content: "plain prompt",
        },
      },
    ]);
  });

  it("carries API error fields on assistant lines", () => {
    const records = [
      assistantRecord([{ type: "text", text: "overloaded" }], {
        isApiErrorMessage: true,
        apiErrorStatus: 529,
        errorDetails: '{"error":{"message":"Overloaded"}}',
      }),
      assistantRecord([{ type: "text", text: "fine" }]),
    ];
    const result = processTranscript(records);
    expect(result.lines[0]).toMatchObject({
      type: "assistant",
      isApiErrorMessage: true,
      apiErrorStatus: 529,
      errorDetails: '{"error":{"message":"Overloaded"}}',
    });
    expect(result.lines[1]!).not.toHaveProperty("isApiErrorMessage");
  });

  it("carries stopReason only when max_tokens", () => {
    const records = [
      assistantRecord([{ type: "text", text: "cut" }], {
        message: {
          role: "assistant",
          content: [{ type: "text", text: "cut" }],
          stop_reason: "max_tokens",
        },
      }),
      assistantRecord([{ type: "text", text: "done" }], {
        message: {
          role: "assistant",
          content: [{ type: "text", text: "done" }],
          stop_reason: "end_turn",
        },
      }),
    ];
    const result = processTranscript(records);
    expect(result.lines[0]).toMatchObject({ stopReason: "max_tokens" });
    expect(result.lines[1]!).not.toHaveProperty("stopReason");
  });

  it("carries usage and attribution fields on assistant lines", () => {
    const records = [
      assistantRecord([{ type: "text", text: "hi" }], {
        message: {
          role: "assistant",
          content: [{ type: "text", text: "hi" }],
          usage: { input_tokens: 1000, output_tokens: 50 },
        },
        attributionSkill: "git:git-workflow",
        attributionPlugin: "git",
        attributionMcpServer: "imcp",
        attributionMcpTool: "weather_current",
      }),
    ];
    const result = processTranscript(records);
    expect(result.lines[0]).toMatchObject({
      usage: { input_tokens: 1000, output_tokens: 50 },
      attributionSkill: "git:git-workflow",
      attributionPlugin: "git",
      attributionMcpServer: "imcp",
      attributionMcpTool: "weather_current",
    });
  });

  it("carries per-turn effort, advisor model, input transformations, and safeguard results on assistant lines", () => {
    const message = {
      role: "assistant",
      content: [{ type: "text", text: "Done." }],
      input_transformations: [
        {
          type: "thinking_dropped",
          path: "messages.2.content.0",
          reason: "model_binding_mismatch",
        },
      ],
      safeguard_results: [
        {
          type: "dangerous_tool_use",
          status: {
            type: "available",
            tool_uses: { toolu_1: { type: "evaluated", outcome: "flagged" } },
          },
        },
      ],
    };
    const records = [
      assistantRecord([], { message, perTurnEffort: "high", advisorModel: "claude-opus-5-5" }),
      assistantRecord([{ type: "text", text: "plain" }], { perTurnEffort: null }),
    ];
    expect(processTranscript(records).lines).toStrictEqual([
      {
        type: "assistant",
        lineIndex: 0,
        perTurnEffort: "high",
        advisorModel: "claude-opus-5-5",
        message,
      },
      {
        type: "assistant",
        lineIndex: 1,
        message: { role: "assistant", content: [{ type: "text", text: "plain" }] },
      },
    ]);
  });

  it("carries the classifier's live cwd, git branch, and platform on user lines", () => {
    const records = [
      userRecord("hello", {
        serverClassifierContext: {
          request: "r1",
          context: {
            git_state: { cwd: "/repo", root: "/repo", branch: "feature", default_branch: "main" },
            live_cwd: "/repo/sub",
            platform: "macos",
          },
        },
      }),
      userRecord("pending", {
        serverClassifierContext: {
          request: "r2",
          context: {
            git_state: { cwd: "/tmp", root: null, branch: null, error: "pending" },
            live_cwd: "/tmp",
          },
        },
      }),
    ];
    expect(processTranscript(records).lines).toStrictEqual([
      {
        type: "user",
        lineIndex: 0,
        classifierContext: { liveCwd: "/repo/sub", branch: "feature", platform: "macos" },
        message: { role: "user", content: "hello" },
      },
      {
        type: "user",
        lineIndex: 1,
        classifierContext: { liveCwd: "/tmp" },
        message: { role: "user", content: "pending" },
      },
    ]);
  });

  it("dedupes consecutive identical attribution onto the first line only", () => {
    const records = [
      assistantRecord([{ type: "text", text: "a" }], { attributionSkill: "build:fix" }),
      assistantRecord([{ type: "text", text: "b" }], { attributionSkill: "build:fix" }),
      assistantRecord([{ type: "text", text: "c" }], { attributionSkill: "other:skill" }),
      assistantRecord([{ type: "text", text: "d" }]),
      assistantRecord([{ type: "text", text: "e" }], { attributionSkill: "build:fix" }),
    ];
    const result = processTranscript(records);
    expect(result.lines[0]).toMatchObject({ attributionSkill: "build:fix" });
    expect(result.lines[1]!).not.toHaveProperty("attributionSkill");
    expect(result.lines[2]).toMatchObject({ attributionSkill: "other:skill" });
    expect(result.lines[3]!).not.toHaveProperty("attributionSkill");
    expect(result.lines[4]).toMatchObject({ attributionSkill: "build:fix" });
  });
});

// ---------------------------------------------------------------------------
// System record lines
// ---------------------------------------------------------------------------

describe("system record lines", () => {
  it("emits a system line for compact_boundary with typed compactMetadata", () => {
    const records = [
      {
        type: "system",
        subtype: "compact_boundary",
        content: "Conversation compacted",
        compactMetadata: {
          trigger: "auto",
          preTokens: 261187,
          postTokens: 10827,
          durationMs: 48788,
          preCompactDiscoveredTools: ["ExitPlanMode"],
        },
        uuid: "s-1",
        timestamp: "1999-12-31T00:00:00Z",
      },
    ];
    const result = processTranscript(records);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({
      type: "system",
      subtype: "compact_boundary",
      content: "Conversation compacted",
      compactMetadata: { trigger: "auto", preTokens: 261187, postTokens: 10827 },
      uuid: "s-1",
      lineIndex: 0,
    });
  });

  it("skips unrendered system subtypes and local_command echoes without commandRun", () => {
    const records = [
      { type: "system", subtype: "informational", content: "x" },
      { type: "system", subtype: "local_command", content: "y" },
    ];
    expect(processTranscript(records).lines).toStrictEqual([]);
  });

  it("emits scheduled_task_fire with its task, cron, prompt, and no-op streak", () => {
    const records = [
      {
        type: "system",
        subtype: "scheduled_task_fire",
        content: "Running scheduled task (Sep 14 9:19am)",
        uuid: "fire-1",
        timestamp: "2026-09-14T13:19:28.170Z",
        taskId: "e283ee16",
        cron: "*/1 * * * *",
        prompt: "Check the dev server",
        taskKind: "loop",
        cronKind: "loop",
        noOpStreak: 2,
        streakStartedAt: "2026-09-14T13:00:00.000Z",
        foldedUuids: ["a", "b"],
      },
    ];
    expect(processTranscript(records).lines).toStrictEqual([
      {
        type: "system",
        subtype: "scheduled_task_fire",
        content: "Running scheduled task (Sep 14 9:19am)",
        taskId: "e283ee16",
        cron: "*/1 * * * *",
        prompt: "Check the dev server",
        taskKind: "loop",
        cronKind: "loop",
        noOpStreak: 2,
        uuid: "fire-1",
        timestamp: "2026-09-14T13:19:28.170Z",
        lineIndex: 0,
      },
    ]);
  });

  it("emits bridge_status records with their Remote Control url", () => {
    const records = [
      {
        type: "system",
        subtype: "bridge_status",
        content: "/remote-control is active. Code in CLI or at https://claude.ai/code/session_01",
        url: "https://claude.ai/code/session_01",
        uuid: "bridge-1",
      },
    ];
    expect(processTranscript(records).lines).toStrictEqual([
      {
        type: "system",
        subtype: "bridge_status",
        content: "/remote-control is active. Code in CLI or at https://claude.ai/code/session_01",
        url: "https://claude.ai/code/session_01",
        uuid: "bridge-1",
        lineIndex: 0,
      },
    ]);
  });

  it("emits local_command records that name the slash command they ran", () => {
    const records = [
      {
        type: "system",
        subtype: "local_command",
        content: "<local-command-stdout>Session renamed to: daily</local-command-stdout>",
        uuid: "cmd-1",
        commandRun: { command: "rename", args: "daily" },
      },
    ];
    expect(processTranscript(records).lines).toStrictEqual([
      {
        type: "system",
        subtype: "local_command",
        content: "<local-command-stdout>Session renamed to: daily</local-command-stdout>",
        commandRun: { command: "rename", args: "daily" },
        uuid: "cmd-1",
        lineIndex: 0,
      },
    ]);
  });

  it("emits stop_hook_summary with hook fields", () => {
    const records = [
      {
        type: "system",
        subtype: "stop_hook_summary",
        hookCount: 3,
        hookErrors: ["boom"],
        hookInfos: [{ name: "precommit" }],
        hookAdditionalContext: ["ctx"],
        preventedContinuation: true,
        hasOutput: true,
      },
    ];
    const result = processTranscript(records);
    expect(result.lines[0]).toMatchObject({
      type: "system",
      subtype: "stop_hook_summary",
      hookCount: 3,
      hookErrors: ["boom"],
      hookInfos: [{ name: "precommit" }],
      hookAdditionalContext: ["ctx"],
      preventedContinuation: true,
    });
  });

  it("emits api_error with retry fields", () => {
    const records = [
      {
        type: "system",
        subtype: "api_error",
        error: { message: "Overloaded" },
        retryAttempt: 2,
        retryInMs: 4000,
        maxRetries: 10,
      },
    ];
    const result = processTranscript(records);
    expect(result.lines[0]).toMatchObject({
      type: "system",
      subtype: "api_error",
      error: { message: "Overloaded" },
      retryAttempt: 2,
      retryInMs: 4000,
      maxRetries: 10,
    });
  });

  it("emits turn_duration with durationMs and pending agents", () => {
    const records = [
      {
        type: "system",
        subtype: "turn_duration",
        durationMs: 12500,
        pendingBackgroundAgentCount: 2,
      },
    ];
    const result = processTranscript(records);
    expect(result.lines[0]).toMatchObject({
      type: "system",
      subtype: "turn_duration",
      durationMs: 12500,
      pendingBackgroundAgentCount: 2,
    });
  });
});

// ---------------------------------------------------------------------------
// Worktree state lines
// ---------------------------------------------------------------------------

describe("worktree state lines", () => {
  const session = {
    originalCwd: "/Users/x/proj",
    worktreePath: "/Users/x/proj-wt",
    worktreeName: "fix-bug",
    worktreeBranch: "fix-bug-branch",
    sessionId: "s",
    originalBranch: "main",
    originalHeadCommit: "abc1234def5678",
    enteredExisting: true,
  };

  it("emits a worktree line and dedupes unchanged repeats", () => {
    const records = [
      { type: "worktree-state", worktreeSession: session },
      { type: "worktree-state", worktreeSession: session },
    ];
    const result = processTranscript(records);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({
      type: "worktree",
      worktreeName: "fix-bug",
      worktreeBranch: "fix-bug-branch",
      originalBranch: "main",
      originalHeadCommit: "abc1234def5678",
      originalCwd: "/Users/x/proj",
      enteredExisting: true,
    });
  });

  it("emits again when the worktree changes", () => {
    const records = [
      { type: "worktree-state", worktreeSession: session },
      { type: "worktree-state", worktreeSession: { ...session, worktreeName: "other" } },
    ];
    expect(processTranscript(records).lines).toHaveLength(2);
  });

  it("skips null worktreeSession", () => {
    const records = [{ type: "worktree-state", worktreeSession: null }];
    expect(processTranscript(records).lines).toStrictEqual([]);
  });

  it("skips hook-based worktree sessions without branch metadata", () => {
    const records = [
      {
        type: "worktree-state",
        worktreeSession: {
          originalCwd: "/tmp/test/project",
          preEnterOriginalCwd: "/tmp/test/project",
          worktreePath: "/tmp/test/worktree",
          worktreeName: "alice-worktree",
          sessionId: "session-100",
          hookBased: true,
        },
      },
    ];

    expect(processTranscript(records).lines).toStrictEqual([]);
  });
});

describe("schema-rejected records", () => {
  it("emits a visible unparsed line instead of silently dropping the record", () => {
    const result = processTranscript([
      userRecord("Hello"),
      { type: "assistant", uuid: "u-2", timestamp: "2026-08-07T00:00:00.000Z", unknownKey: 1 },
      userRecord("Goodbye"),
    ]);

    expect(
      result.lines.map((line) => (line.type === "unparsed" ? { ...line, issues: [] } : line.type)),
    ).toStrictEqual([
      "user",
      {
        type: "unparsed",
        lineIndex: 1,
        recordType: "assistant",
        uuid: "u-2",
        timestamp: "2026-08-07T00:00:00.000Z",
        issues: [],
      },
      "user",
    ]);
  });

  it("reports why the record was rejected", () => {
    const result = processTranscript([
      { type: "assistant", message: { role: "assistant", content: [] }, unknownKey: 1 },
    ]);
    const line = result.lines[0];

    expect(line?.type === "unparsed" ? line.issues : []).toStrictEqual([
      'Unrecognized key: "unknownKey"',
    ]);
  });

  it("keeps records whose type is not rendered out of the transcript", () => {
    const result = processTranscript([
      { type: "file-history-snapshot", messageId: "m-1", snapshot: { trackedFileBackups: {} } },
    ]);

    expect(result.lines).toStrictEqual([]);
  });
});

describe("artifact records", () => {
  const uuid = "29d89ae8-e33b-4f55-bbbd-874d5d316169";
  const frameUrl = `https://claude.ai/code/artifact/${uuid}`;

  it("emits a published-artifact line for a frame-link that names its artifact", () => {
    const records = [
      {
        type: "frame-link",
        sessionId: "s-1",
        path: "/tmp/test/page.html",
        frameUrl,
        title: "Quarto Oracle",
        artifactCount: 1,
        timestamp: "2000-01-01T00:00:00.000Z",
      },
    ];
    expect(processTranscript(records).lines).toStrictEqual([
      {
        type: "artifact-link",
        frameUrl,
        title: "Quarto Oracle",
        path: "/tmp/test/page.html",
        timestamp: "2000-01-01T00:00:00.000Z",
        lineIndex: 0,
      },
    ]);
  });

  it("skips count-only frame-link heartbeats and unchanged republishes", () => {
    const published = { type: "frame-link", frameUrl, title: "Quarto Oracle", artifactCount: 1 };
    const records = [
      published,
      { type: "frame-link", artifactCount: 1, sessionId: "s-1" },
      published,
      { ...published, title: "Quarto Oracle v2" },
    ];
    expect(processTranscript(records).lines).toStrictEqual([
      { type: "artifact-link", frameUrl, title: "Quarto Oracle", lineIndex: 0 },
      { type: "artifact-link", frameUrl, title: "Quarto Oracle v2", lineIndex: 3 },
    ]);
  });

  it("emits a watch line naming the artifacts the comment monitor watches", () => {
    const records = [
      {
        type: "artifact-comment-monitor",
        v: 1,
        sessionId: "s-1",
        artifacts: {
          [uuid]: { state: "armed", writtenAtMs: 1, title: "Quarto Oracle" },
          "https://claude.ai/artifact/some-slug": { state: "paused" },
        },
      },
    ];
    expect(processTranscript(records).lines).toStrictEqual([
      {
        type: "artifact-watch",
        artifacts: [
          { url: frameUrl, title: "Quarto Oracle", state: "armed" },
          { url: "https://claude.ai/artifact/some-slug", state: "paused" },
        ],
        lineIndex: 0,
      },
    ]);
  });

  it("dedupes unchanged monitor state and folds in ledger comment threads", () => {
    const monitor = {
      type: "artifact-comment-monitor",
      v: 1,
      artifacts: { [uuid]: { state: "armed", writtenAtMs: 1, title: "Quarto Oracle" } },
    };
    const records = [
      monitor,
      {
        ...monitor,
        artifacts: { [uuid]: { state: "armed", writtenAtMs: 2, title: "Quarto Oracle" } },
      },
      {
        type: "artifact-autoreact-ledger",
        v: 1,
        artifacts: {
          [uuid]: { savedAt: 1, stampHighWater: null, threads: [], turnTimestamps: [] },
        },
      },
      {
        type: "artifact-autoreact-ledger",
        v: 1,
        artifacts: {
          [uuid]: { savedAt: 2, stampHighWater: "x", threads: [{ id: "t1" }, { id: "t2" }] },
        },
      },
    ];
    expect(processTranscript(records).lines).toStrictEqual([
      {
        type: "artifact-watch",
        artifacts: [{ url: frameUrl, title: "Quarto Oracle", state: "armed" }],
        lineIndex: 0,
      },
      {
        type: "artifact-watch",
        artifacts: [{ url: frameUrl, title: "Quarto Oracle", state: "armed", commentThreads: 2 }],
        lineIndex: 3,
      },
    ]);
  });

  it("emits nothing for an empty monitor", () => {
    const records = [{ type: "artifact-comment-monitor", v: 1, artifacts: {} }];
    expect(processTranscript(records).lines).toStrictEqual([]);
  });
});
