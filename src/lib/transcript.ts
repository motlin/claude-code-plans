/**
 * Shared transcript processing library.
 *
 * Processes raw JSONL records into rendering data. Works identically in
 * Node (for indexing) and browser (for rendering) -- no Node-specific imports.
 *
 * Core function: processTranscript(records) returns ProcessedTranscript.
 * Incremental function: processNewRecords(records, startIndex) for SSE appends.
 */

import { z } from "zod";
import type { ToolResultInfo } from "./sessions";
import {
  CompactMetadataSchema,
  ContentBlockSchema,
  JsonValueSchema,
  JsonlRecordSchema,
  PromptSourceSchema,
} from "./schemas";
import {
  extractSessionTitle,
  extractToolResultContent,
  stripCommandTags,
  stripResultTags,
  truncateResult,
} from "./session-utils";

// ---------------------------------------------------------------------------
// Rendered line schemas -- Zod definitions for processed JSONL output.
// Types are inferred via z.infer<> instead of manually declared interfaces.
// ---------------------------------------------------------------------------

const MessageLineSchema = z.object({
  type: z.enum(["user", "assistant"]),
  uuid: z.string().optional(),
  parentUuid: z.string().optional(),
  timestamp: z.string().optional(),
  userType: z.string().optional(),
  isMeta: z.boolean().optional(),
  isCompactSummary: z.boolean().optional(),
  isVisibleInTranscriptOnly: z.boolean().optional(),
  message: z
    .object({
      role: z.string().optional(),
      content: z.union([z.string(), z.array(ContentBlockSchema)]).optional(),
    })
    .optional(),
  customTitle: z.string().optional(),
  sessionId: z.string().optional(),
  lineIndex: z.number(),
  promptSource: PromptSourceSchema.optional(),
  isApiErrorMessage: z.boolean().optional(),
  apiErrorStatus: z.union([z.number(), z.string()]).optional(),
  errorDetails: z.union([z.string(), z.record(z.string(), JsonValueSchema)]).optional(),
  stopReason: z.literal("max_tokens").optional(),
  usage: z.record(z.string(), JsonValueSchema).optional(),
  attributionSkill: z.string().optional(),
  attributionPlugin: z.string().optional(),
  attributionMcpServer: z.string().optional(),
  attributionMcpTool: z.string().optional(),
});

const AgentNameLineSchema = z.object({
  type: z.literal("agent-name"),
  agentName: z.string(),
  lineIndex: z.number(),
});

const AgentColorLineSchema = z.object({
  type: z.literal("agent-color"),
  agentColor: z.string(),
  lineIndex: z.number(),
});

const PermissionModeLineSchema = z.object({
  type: z.literal("permission-mode"),
  permissionMode: z.string(),
  lineIndex: z.number(),
});

const PrLinkLineSchema = z.object({
  type: z.literal("pr-link"),
  prUrl: z.string(),
  prNumber: z.number(),
  prRepository: z.string(),
  timestamp: z.string().optional(),
  lineIndex: z.number(),
});

const AttachmentLineSchema = z.object({
  type: z.literal("attachment"),
  attachmentJson: z.string(),
  uuid: z.string().optional(),
  timestamp: z.string().optional(),
  lineIndex: z.number(),
});

/** System-record subtypes the viewer renders; all others are skipped. */
const RenderedSystemSubtypeSchema = z.enum([
  "compact_boundary",
  "stop_hook_summary",
  "api_error",
  "turn_duration",
]);

const SystemLineSchema = z.object({
  type: z.literal("system"),
  subtype: RenderedSystemSubtypeSchema,
  content: z.string().optional(),
  compactMetadata: CompactMetadataSchema.optional(),
  hookCount: z.number().optional(),
  hookInfos: z.array(JsonValueSchema).optional(),
  hookErrors: z.array(JsonValueSchema).optional(),
  hookAdditionalContext: z.array(JsonValueSchema).optional(),
  preventedContinuation: z.boolean().optional(),
  retryAttempt: z.number().optional(),
  retryInMs: z.number().optional(),
  maxRetries: z.number().optional(),
  pendingBackgroundAgentCount: z.number().optional(),
  durationMs: z.number().optional(),
  error: z.union([z.string(), z.record(z.string(), JsonValueSchema)]).optional(),
  uuid: z.string().optional(),
  timestamp: z.string().optional(),
  lineIndex: z.number(),
});

const WorktreeLineSchema = z.object({
  type: z.literal("worktree"),
  worktreeName: z.string(),
  worktreeBranch: z.string(),
  originalCwd: z.string(),
  originalBranch: z.string().optional(),
  originalHeadCommit: z.string().optional(),
  enteredExisting: z.boolean().optional(),
  lineIndex: z.number(),
});

/**
 * Discriminated union of all rendered line types.
 * Each variant corresponds to a JSONL record type that produces visible output.
 */
export const RenderedLineSchema = z.discriminatedUnion("type", [
  MessageLineSchema,
  AgentNameLineSchema,
  AgentColorLineSchema,
  PermissionModeLineSchema,
  PrLinkLineSchema,
  AttachmentLineSchema,
  SystemLineSchema,
  WorktreeLineSchema,
]);

// ---------------------------------------------------------------------------
// Exported types -- all inferred from schemas above
// ---------------------------------------------------------------------------

export type MessageProcessedLine = z.infer<typeof MessageLineSchema>;
export type ProcessedLine = z.infer<typeof RenderedLineSchema>;

// Convenience aliases used by consumers
export type SessionLine = ProcessedLine;
export type MessageSessionLine = MessageProcessedLine;
export type SessionContentBlock = z.infer<typeof ContentBlockSchema>;

// ---------------------------------------------------------------------------
// Transcript result types
// ---------------------------------------------------------------------------

export interface ProcessedTranscript {
  lines: ProcessedLine[];
  toolResultMap: Map<string, ToolResultInfo>;
  uuidToLine: Map<string, number>;
  title: string;
  customTitle: string | undefined;
}

interface IncrementalResult {
  newSessionLines: ProcessedLine[];
  newToolResults: Map<string, ToolResultInfo>;
}

// ---------------------------------------------------------------------------
// Command group deduplication
// ---------------------------------------------------------------------------

const COMMAND_NAME_RE = /<command-name>/;
const LOCAL_COMMAND_CAVEAT_RE = /^<local-command-caveat>/;
const LOCAL_COMMAND_STDOUT_RE = /^<local-command-stdout>/;

/**
 * Get the string content of a user message line, if it has string content.
 */
function getUserStringContent(line: ProcessedLine): string | undefined {
  if (line.type !== "user") return undefined;
  const content = line.message?.content;
  if (typeof content === "string") return content;
  return undefined;
}

/**
 * Check whether a user message line is a slash command (contains `<command-name>`).
 */
function isCommandLine(line: ProcessedLine): boolean {
  const text = getUserStringContent(line);
  return text !== undefined && COMMAND_NAME_RE.test(text);
}

/**
 * Check whether a user message line is a local-command-caveat.
 */
function isCaveatLine(line: ProcessedLine): boolean {
  const text = getUserStringContent(line);
  return text !== undefined && LOCAL_COMMAND_CAVEAT_RE.test(text);
}

/**
 * Check whether a user message line is a local-command-stdout.
 */
function isStdoutLine(line: ProcessedLine): boolean {
  const text = getUserStringContent(line);
  return text !== undefined && LOCAL_COMMAND_STDOUT_RE.test(text);
}

/**
 * Check whether a line is a blank assistant message with no visible content.
 * These are transparent for command group dedup -- they don't break adjacency.
 */
function isBlankAssistantLine(line: ProcessedLine): boolean {
  if (line.type !== "assistant") return false;
  const content = (line as MessageProcessedLine).message?.content;
  if (content === undefined || content === null) return true;
  if (typeof content === "string") return content.trim() === "";
  if (Array.isArray(content)) {
    if (content.length === 0) return true;
    return content.every(
      (block) =>
        block.type === "text" && (typeof block.text !== "string" || block.text.trim() === ""),
    );
  }
  return false;
}

/**
 * Remove duplicate consecutive command groups from processed lines.
 *
 * A "command group" is an optional caveat line, followed by a command line,
 * followed by an optional stdout line. When two adjacent command groups have
 * identical command content, the second group is removed.
 *
 * Blank assistant messages between groups are treated as transparent and
 * removed along with the duplicate group.
 */
function deduplicateCommandGroups(lines: ProcessedLine[]): ProcessedLine[] {
  const indicesToRemove = new Set<number>();
  let lastCommandContent: string | undefined;
  let lastCommandGroupEnd = -1;

  for (let i = 0; i < lines.length; i++) {
    if (!isCommandLine(lines[i]!)) {
      // Non-command lines that aren't part of a command group reset tracking,
      // unless they're caveats, stdouts, or blank assistant messages.
      if (
        !isCaveatLine(lines[i]!) &&
        !isStdoutLine(lines[i]!) &&
        !isBlankAssistantLine(lines[i]!)
      ) {
        lastCommandContent = undefined;
        lastCommandGroupEnd = -1;
      }
      continue;
    }

    const commandContent = getUserStringContent(lines[i]!)!;

    // Determine the boundaries of this command group
    const groupStart = i > 0 && isCaveatLine(lines[i - 1]!) ? i - 1 : i;
    const groupEnd = i + 1 < lines.length && isStdoutLine(lines[i + 1]!) ? i + 1 : i;

    // Check adjacency: all lines between the previous group end and this group start
    // must be blank assistants (transparent lines) for the groups to be "adjacent".
    const gapStart = lastCommandGroupEnd + 1;
    const gapEnd = groupStart;
    let adjacentToPrevious = gapStart >= gapEnd;
    if (!adjacentToPrevious) {
      adjacentToPrevious = true;
      for (let j = gapStart; j < gapEnd; j++) {
        if (!isBlankAssistantLine(lines[j]!)) {
          adjacentToPrevious = false;
          break;
        }
      }
    }

    if (commandContent === lastCommandContent && adjacentToPrevious) {
      // Duplicate command group -- mark for removal
      for (let j = groupStart; j <= groupEnd; j++) {
        indicesToRemove.add(j);
      }
      // Also remove blank assistant messages in the gap
      for (let j = gapStart; j < gapEnd; j++) {
        if (isBlankAssistantLine(lines[j]!)) {
          indicesToRemove.add(j);
        }
      }
    } else {
      lastCommandContent = commandContent;
    }
    lastCommandGroupEnd = groupEnd;
  }

  if (indicesToRemove.size === 0) return lines;
  return lines.filter((_, index) => !indicesToRemove.has(index));
}

function processRecordBatch(
  records: unknown[],
  startLineIndex: number,
  uuidToLine?: Map<string, number>,
): {
  sessionLines: ProcessedLine[];
  toolResults: Map<string, ToolResultInfo>;
  title: string;
  customTitle: string | undefined;
} {
  const sessionLines: ProcessedLine[] = [];
  const toolResults = new Map<string, ToolResultInfo>();
  const toolStartTimes = new Map<string, number>();
  let title = "";
  let lastWorktreeKey: string | undefined;
  let lastAttributionKey: string | undefined;
  let customTitle: string | undefined;

  for (let i = 0; i < records.length; i++) {
    const obj = records[i]!;
    const lineIndex = startLineIndex + i;

    const parsed = JsonlRecordSchema.safeParse(obj);
    if (!parsed.success) continue;
    const record = parsed.data;

    const uuid = "uuid" in record && typeof record.uuid === "string" ? record.uuid : undefined;
    if (uuid && uuidToLine) uuidToLine.set(uuid, lineIndex);

    if (record.type === "custom-title") {
      customTitle = record.customTitle;
      continue;
    }

    // Extract title from first user text
    if (record.type === "user" && !title) {
      const { content } = record.message;
      if (typeof content === "string") {
        const cleaned = stripCommandTags(content);
        if (cleaned) title = extractSessionTitle(cleaned);
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text") {
            const cleaned = stripCommandTags(block.text);
            if (cleaned) {
              title = extractSessionTitle(cleaned);
              break;
            }
          }
        }
      }
    }

    // Track tool_use start times from assistant messages
    if (record.type === "assistant") {
      const { content } = record.message;
      const timestamp = record.timestamp;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "tool_use") {
            if (timestamp) {
              const t = new Date(timestamp).getTime();
              if (!isNaN(t)) toolStartTimes.set(block.id, t);
            }
          }
        }
      }
    }

    // Pair tool_result blocks from user messages
    if (record.type === "user") {
      const { content } = record.message;
      const timestamp = record.timestamp;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "tool_result") {
            const rawResult = extractToolResultContent(block.content);
            if (rawResult !== undefined) {
              const resultText = stripResultTags(rawResult);
              const info: ToolResultInfo = {
                result: truncateResult(resultText, 150),
                isError: block.is_error === true,
                resultUuid: uuid ?? "",
              };
              const startTime = toolStartTimes.get(block.tool_use_id);
              if (startTime && timestamp) {
                const resultTime = new Date(timestamp).getTime();
                if (!isNaN(resultTime) && resultTime > startTime) {
                  info.duration = resultTime - startTime;
                }
              }
              toolResults.set(block.tool_use_id, info);
            }
          }
        }
      }
    }

    // Non-message rendering line types
    if (record.type === "agent-name") {
      sessionLines.push({
        type: "agent-name",
        agentName: record.agentName,
        lineIndex,
      });
      continue;
    }
    if (record.type === "agent-color") {
      sessionLines.push({
        type: "agent-color",
        agentColor: record.agentColor,
        lineIndex,
      });
      continue;
    }
    if (record.type === "permission-mode") {
      sessionLines.push({
        type: "permission-mode",
        permissionMode: record.permissionMode,
        lineIndex,
      });
      continue;
    }
    if (record.type === "pr-link") {
      const prLine: z.infer<typeof PrLinkLineSchema> = {
        type: "pr-link",
        prUrl: record.prUrl,
        prNumber: record.prNumber,
        prRepository: record.prRepository,
        lineIndex,
      };
      if (record.timestamp !== undefined) prLine.timestamp = record.timestamp;
      sessionLines.push(prLine);
      continue;
    }

    if (record.type === "attachment") {
      const attachmentLine: z.infer<typeof AttachmentLineSchema> = {
        type: "attachment",
        attachmentJson: JSON.stringify(record.attachment),
        lineIndex,
      };
      if (uuid !== undefined) attachmentLine.uuid = uuid;
      if (record.timestamp !== undefined) attachmentLine.timestamp = record.timestamp;
      sessionLines.push(attachmentLine);
      continue;
    }

    if (record.type === "system") {
      const subtype = RenderedSystemSubtypeSchema.safeParse(record.subtype);
      if (!subtype.success) continue;
      const systemLine: z.infer<typeof SystemLineSchema> = {
        type: "system",
        subtype: subtype.data,
        lineIndex,
      };
      if (record.content !== undefined) systemLine.content = record.content;
      if (record.compactMetadata !== undefined) systemLine.compactMetadata = record.compactMetadata;
      if (record.hookCount !== undefined) systemLine.hookCount = record.hookCount;
      if (record.hookInfos !== undefined) systemLine.hookInfos = record.hookInfos;
      if (record.hookErrors !== undefined) systemLine.hookErrors = record.hookErrors;
      if (record.hookAdditionalContext !== undefined) {
        systemLine.hookAdditionalContext = record.hookAdditionalContext;
      }
      if (record.preventedContinuation !== undefined) {
        systemLine.preventedContinuation = record.preventedContinuation;
      }
      if (record.retryAttempt !== undefined) systemLine.retryAttempt = record.retryAttempt;
      if (record.retryInMs !== undefined) systemLine.retryInMs = record.retryInMs;
      if (record.maxRetries !== undefined) systemLine.maxRetries = record.maxRetries;
      if (record.pendingBackgroundAgentCount !== undefined) {
        systemLine.pendingBackgroundAgentCount = record.pendingBackgroundAgentCount;
      }
      if (record.durationMs !== undefined) systemLine.durationMs = record.durationMs;
      if (record.error !== undefined) systemLine.error = record.error;
      if (uuid !== undefined) systemLine.uuid = uuid;
      if (record.timestamp !== undefined) systemLine.timestamp = record.timestamp;
      sessionLines.push(systemLine);
      continue;
    }

    if (record.type === "worktree-state") {
      const ws = record.worktreeSession;
      if (ws === undefined || ws === null) continue;
      // Worktree state is re-emitted on every prompt; only render changes.
      const worktreeKey = JSON.stringify([
        ws.worktreeName,
        ws.worktreeBranch,
        ws.originalBranch,
        ws.originalHeadCommit,
        ws.originalCwd,
        ws.enteredExisting,
      ]);
      if (worktreeKey === lastWorktreeKey) continue;
      lastWorktreeKey = worktreeKey;
      const worktreeLine: z.infer<typeof WorktreeLineSchema> = {
        type: "worktree",
        worktreeName: ws.worktreeName,
        worktreeBranch: ws.worktreeBranch,
        originalCwd: ws.originalCwd,
        lineIndex,
      };
      if (ws.originalBranch !== undefined) worktreeLine.originalBranch = ws.originalBranch;
      if (ws.originalHeadCommit !== undefined) {
        worktreeLine.originalHeadCommit = ws.originalHeadCommit;
      }
      if (ws.enteredExisting !== undefined) worktreeLine.enteredExisting = ws.enteredExisting;
      sessionLines.push(worktreeLine);
      continue;
    }

    // Only include user/assistant lines for the rendering tree
    if (record.type !== "user" && record.type !== "assistant") continue;

    const processedLine: MessageProcessedLine = {
      type: record.type,
      lineIndex,
    };
    if (uuid !== undefined) processedLine.uuid = uuid;
    if (typeof record.parentUuid === "string") processedLine.parentUuid = record.parentUuid;
    if (record.timestamp !== undefined) processedLine.timestamp = record.timestamp;
    if (typeof record.userType === "string") processedLine.userType = record.userType;
    if (record.type === "user") {
      if (record.isMeta === true) processedLine.isMeta = true;
      if (record.isCompactSummary === true) processedLine.isCompactSummary = true;
      if (record.isVisibleInTranscriptOnly === true) processedLine.isVisibleInTranscriptOnly = true;
      if (record.promptSource !== undefined && record.promptSource !== "typed") {
        processedLine.promptSource = record.promptSource;
      }
    }
    if (record.type === "assistant") {
      if (record.isApiErrorMessage === true) processedLine.isApiErrorMessage = true;
      if (record.apiErrorStatus !== undefined) processedLine.apiErrorStatus = record.apiErrorStatus;
      if (record.errorDetails !== undefined) processedLine.errorDetails = record.errorDetails;
      if (record.message.stop_reason === "max_tokens") processedLine.stopReason = "max_tokens";
      if (record.message.usage !== undefined) processedLine.usage = record.message.usage;
      // Attribution repeats on every turn of a skill/MCP block; only carry it
      // onto the first line of each run so the UI shows one pill per block.
      const attributionKey = JSON.stringify([
        record.attributionSkill,
        record.attributionPlugin,
        record.attributionMcpServer,
        record.attributionMcpTool,
      ]);
      if (attributionKey !== lastAttributionKey) {
        lastAttributionKey = attributionKey;
        if (record.attributionSkill !== undefined) {
          processedLine.attributionSkill = record.attributionSkill;
        }
        if (record.attributionPlugin !== undefined) {
          processedLine.attributionPlugin = record.attributionPlugin;
        }
        if (record.attributionMcpServer !== undefined) {
          processedLine.attributionMcpServer = record.attributionMcpServer;
        }
        if (record.attributionMcpTool !== undefined) {
          processedLine.attributionMcpTool = record.attributionMcpTool;
        }
      }
    }
    // The Zod-parsed message uses the ContentBlock type directly --
    // no intermediate serialization type needed.
    processedLine.message = record.message as MessageProcessedLine["message"];

    sessionLines.push(processedLine);
  }

  return {
    sessionLines: deduplicateCommandGroups(sessionLines),
    toolResults,
    title,
    customTitle,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Process raw JSONL records into rendering data.
 *
 * Takes the raw JSON objects from the transcript API and returns everything
 * the renderer needs: lines, toolResultMap, uuidToLine, title, customTitle.
 */
export function processTranscript(records: unknown[]): ProcessedTranscript {
  const uuidToLine = new Map<string, number>();
  const { sessionLines, toolResults, title, customTitle } = processRecordBatch(
    records,
    0,
    uuidToLine,
  );
  return {
    lines: sessionLines,
    toolResultMap: toolResults,
    uuidToLine,
    title,
    customTitle,
  };
}

/**
 * Process new JSONL records incrementally for SSE appends.
 *
 * Same processing logic as processTranscript but returns data shaped for
 * merging into existing state.
 *
 * @param records - Raw JSON objects from the SSE event
 * @param startIndex - The JSONL line index to start counting from
 */
export function processNewRecords(records: unknown[], startIndex: number): IncrementalResult {
  const { sessionLines, toolResults } = processRecordBatch(records, startIndex);
  return {
    newSessionLines: sessionLines,
    newToolResults: toolResults,
  };
}
