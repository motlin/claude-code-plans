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
import { toolResultMetaFrom } from "./tool-labels";
import { normalizeArtifactUrl, parseArtifactOutput } from "./artifact-output";
import { ArtifactToolResultSchema } from "./artifact-schemas";
import {
  CompactMetadataSchema,
  ContentBlockSchema,
  JsonValueSchema,
  JsonlRecordSchema,
  PromptSourceSchema,
  RenderedRoleSchema,
  TurnOriginSchema,
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
      input_transformations: z
        .array(
          z.object({
            type: z.string(),
            path: z.string().optional(),
            reason: z.string().optional(),
          }),
        )
        .optional(),
      safeguard_results: z
        .array(
          z.object({
            type: z.string(),
            status: z
              .object({
                type: z.string(),
                tool_uses: z
                  .record(
                    z.string(),
                    z.object({ type: z.string(), outcome: z.string().optional() }),
                  )
                  .optional(),
              })
              .optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  customTitle: z.string().optional(),
  sessionId: z.string().optional(),
  lineIndex: z.number(),
  promptSource: PromptSourceSchema.optional(),
  turnOrigin: TurnOriginSchema.optional(),
  scheduledTaskId: z.string().optional(),
  queuePriority: z.literal("later").optional(),
  isApiErrorMessage: z.boolean().optional(),
  apiErrorStatus: z.union([z.number(), z.string()]).optional(),
  errorDetails: z.union([z.string(), z.record(z.string(), JsonValueSchema)]).optional(),
  stopReason: z.literal("max_tokens").optional(),
  usage: z.record(z.string(), JsonValueSchema).optional(),
  attributionSkill: z.string().optional(),
  attributionPlugin: z.string().optional(),
  attributionMcpServer: z.string().optional(),
  attributionMcpTool: z.string().optional(),
  perTurnEffort: z.string().optional(),
  advisorModel: z.string().optional(),
  /** What the server-side permission classifier saw for this user turn. */
  classifierContext: z
    .object({
      liveCwd: z.string().optional(),
      branch: z.string().optional(),
      platform: z.string().optional(),
    })
    .optional(),
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

/** An artifact the session published, from a `frame-link` record that names one. */
const ArtifactLinkLineSchema = z.object({
  type: z.literal("artifact-link"),
  frameUrl: z.string(),
  title: z.string().optional(),
  path: z.string().optional(),
  timestamp: z.string().optional(),
  lineIndex: z.number(),
});

/**
 * The artifacts the session watches for comments, from the latest
 * `artifact-comment-monitor` record, with thread counts from the latest
 * `artifact-autoreact-ledger`.
 */
const ArtifactWatchLineSchema = z.object({
  type: z.literal("artifact-watch"),
  artifacts: z.array(
    z.object({
      url: z.string(),
      title: z.string().optional(),
      state: z.string().optional(),
      commentThreads: z.number().optional(),
    }),
  ),
  lineIndex: z.number(),
});

const AttachmentLineSchema = z.object({
  type: z.literal("attachment"),
  attachmentJson: z.string(),
  // The exact context text the attachment rendered into the model's turn.
  rendered: z.array(z.string()).optional(),
  renderedInHumanTurn: z.array(z.string()).optional(),
  renderedRole: RenderedRoleSchema.optional(),
  // A queued_command whose prompt was absorbed into the running turn, linked by
  // a `queue-operation` removal's commandUuid matching the attachment's source_uuid.
  absorbedMidTurn: z.literal(true).optional(),
  uuid: z.string().optional(),
  timestamp: z.string().optional(),
  sessionId: z.string().optional(),
  lineIndex: z.number(),
});

/** System-record subtypes the viewer renders; all others are skipped. */
const RenderedSystemSubtypeSchema = z.enum([
  "compact_boundary",
  "stop_hook_summary",
  "api_error",
  "turn_duration",
  "scheduled_task_fire",
  "local_command",
  "bridge_status",
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
  taskId: z.string().optional(),
  cron: z.string().optional(),
  prompt: z.string().optional(),
  taskKind: z.string().optional(),
  cronKind: z.string().optional(),
  noOpStreak: z.number().optional(),
  commandRun: z.object({ command: z.string(), args: z.string().optional() }).optional(),
  url: z.string().optional(),
  uuid: z.string().optional(),
  timestamp: z.string().optional(),
  sessionId: z.string().optional(),
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
 * A record the schema rejected. Rendered as a visible gap so schema drift
 * surfaces in the transcript instead of silently deleting messages.
 */
const UnparsedLineSchema = z.object({
  type: z.literal("unparsed"),
  recordType: z.string().optional(),
  issues: z.array(z.string()),
  uuid: z.string().optional(),
  timestamp: z.string().optional(),
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
  ArtifactLinkLineSchema,
  ArtifactWatchLineSchema,
  AttachmentLineSchema,
  SystemLineSchema,
  WorktreeLineSchema,
  UnparsedLineSchema,
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

/**
 * Describe a schema-rejected record well enough to render a placeholder and
 * diagnose the drift, reading only fields we cannot trust to be present.
 */
function buildUnparsedLine(
  obj: unknown,
  lineIndex: number,
  error: z.ZodError,
): Extract<ProcessedLine, { type: "unparsed" }> {
  const raw = typeof obj === "object" && obj !== null ? (obj as Record<string, unknown>) : {};
  const line: Extract<ProcessedLine, { type: "unparsed" }> = {
    type: "unparsed",
    lineIndex,
    issues: error.issues.map((issue) =>
      issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message,
    ),
  };
  if (typeof raw["type"] === "string") line.recordType = raw["type"];
  if (typeof raw["uuid"] === "string") line.uuid = raw["uuid"];
  if (typeof raw["timestamp"] === "string") line.timestamp = raw["timestamp"];
  return line;
}

function getRecordSessionId(record: z.infer<typeof JsonlRecordSchema>): string | undefined {
  if ("sessionId" in record && typeof record.sessionId === "string") {
    return record.sessionId;
  }
  if ("session_id" in record && typeof record.session_id === "string") {
    return record.session_id;
  }
  return undefined;
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
export function isCommandLine(line: ProcessedLine): boolean {
  const text = getUserStringContent(line);
  return text !== undefined && COMMAND_NAME_RE.test(text);
}

/**
 * Check whether a user message line is a local-command-caveat.
 */
export function isCaveatLine(line: ProcessedLine): boolean {
  const text = getUserStringContent(line);
  return text !== undefined && LOCAL_COMMAND_CAVEAT_RE.test(text);
}

/**
 * Check whether a user message line is a local-command-stdout.
 */
export function isStdoutLine(line: ProcessedLine): boolean {
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

/**
 * Decorates a successful `Artifact` result with the artifact it points at, or
 * the artifacts a `list` returned. A result is an Artifact one when its
 * tool_use was seen in this batch, or when its structured `toolUseResult`
 * matches the strict Artifact result schemas (the tool_use arrived earlier).
 */
function addArtifactDecoration(
  info: ToolResultInfo,
  resultText: string,
  toolUseResult: unknown,
  toolName: string | undefined,
): void {
  const structured = ArtifactToolResultSchema.safeParse(toolUseResult);
  const structuredObject =
    structured.success && typeof structured.data === "object" ? structured.data : undefined;
  if (toolName !== "Artifact" && structuredObject === undefined) return;
  if (structuredObject !== undefined && "artifacts" in structuredObject) {
    info.artifactList = structuredObject.artifacts;
    return;
  }
  const artifact = parseArtifactOutput(resultText, toolUseResult);
  if (artifact !== undefined) info.artifact = artifact;
}

type ArtifactWatchEntry = z.infer<typeof ArtifactWatchLineSchema>["artifacts"][number];

/**
 * The page URL for an artifact-monitor key, which is an artifact id (a code
 * artifact's uuid or a published slug) or, occasionally, the full URL.
 */
function artifactKeyUrl(key: string): string {
  const direct = normalizeArtifactUrl(key);
  if (direct !== undefined) return direct.url;
  const fromId = normalizeArtifactUrl(`https://claude.ai/code/artifact/${key}`);
  if (fromId === undefined) return key;
  return fromId.kind === "slug" ? `https://claude.ai/artifact/${fromId.id}` : fromId.url;
}

/** Combines the latest monitor and ledger records into the watched-artifact list. */
function artifactWatchEntries(
  monitor: Extract<z.infer<typeof JsonlRecordSchema>, { type: "artifact-comment-monitor" }>,
  ledger:
    | Extract<z.infer<typeof JsonlRecordSchema>, { type: "artifact-autoreact-ledger" }>
    | undefined,
): ArtifactWatchEntry[] {
  return Object.entries(monitor.artifacts ?? {}).map(([key, watched]) => {
    const entry: ArtifactWatchEntry = { url: artifactKeyUrl(key) };
    if (watched.title !== undefined) entry.title = watched.title;
    if (watched.state !== undefined) entry.state = watched.state;
    const threads = ledger?.artifacts?.[key]?.threads?.length ?? 0;
    if (threads > 0) entry.commentThreads = threads;
    return entry;
  });
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
  const toolNames = new Map<string, string>();
  let title = "";
  let lastWorktreeKey: string | undefined;
  let lastAttributionKey: string | undefined;
  let customTitle: string | undefined;
  const publishedArtifactKeys = new Set<string>();
  let lastMonitor:
    | Extract<z.infer<typeof JsonlRecordSchema>, { type: "artifact-comment-monitor" }>
    | undefined;
  let lastLedger:
    | Extract<z.infer<typeof JsonlRecordSchema>, { type: "artifact-autoreact-ledger" }>
    | undefined;
  let lastArtifactWatchKey: string | undefined;
  // Absorbed removals and queued_command attachments can land in either order.
  const absorbedCommandUuids = new Set<string>();
  const queuedCommandLines = new Map<string, z.infer<typeof AttachmentLineSchema>>();

  for (let i = 0; i < records.length; i++) {
    const obj = records[i]!;
    const lineIndex = startLineIndex + i;

    const parsed = JsonlRecordSchema.safeParse(obj);
    if (!parsed.success) {
      sessionLines.push(buildUnparsedLine(obj, lineIndex, parsed.error));
      continue;
    }
    const record = parsed.data;

    const uuid = "uuid" in record && typeof record.uuid === "string" ? record.uuid : undefined;
    const sessionId = getRecordSessionId(record);
    if (uuid && uuidToLine) uuidToLine.set(uuid, lineIndex);

    if (record.type === "custom-title") {
      customTitle = record.customTitle;
      continue;
    }

    // Extract title from first user text
    if (record.type === "user" && !title) {
      const { content } = record.message;
      const titleOptions = { isMeta: record.isMeta === true };
      if (typeof content === "string") {
        const cleaned = stripCommandTags(content);
        if (cleaned) title = extractSessionTitle(cleaned, undefined, titleOptions);
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text") {
            const cleaned = stripCommandTags(block.text);
            if (cleaned) {
              title = extractSessionTitle(cleaned, undefined, titleOptions);
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
            toolNames.set(block.id, block.name);
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
              const resultMeta = toolResultMetaFrom(record.toolUseResult);
              if (resultMeta !== undefined) info.resultMeta = resultMeta;
              if (!info.isError) {
                addArtifactDecoration(
                  info,
                  resultText,
                  record.toolUseResult,
                  toolNames.get(block.tool_use_id),
                );
              }
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

    if (record.type === "frame-link") {
      // Most frame-link records are count-only heartbeats; a republish that
      // changes nothing is not news either.
      if (record.frameUrl === undefined) continue;
      const publishedKey = JSON.stringify([record.frameUrl, record.title]);
      if (publishedArtifactKeys.has(publishedKey)) continue;
      publishedArtifactKeys.add(publishedKey);
      const artifactLine: z.infer<typeof ArtifactLinkLineSchema> = {
        type: "artifact-link",
        frameUrl: record.frameUrl,
        lineIndex,
      };
      if (record.title !== undefined) artifactLine.title = record.title;
      if (record.path !== undefined) artifactLine.path = record.path;
      if (record.timestamp !== undefined) artifactLine.timestamp = record.timestamp;
      sessionLines.push(artifactLine);
      continue;
    }

    if (record.type === "artifact-comment-monitor" || record.type === "artifact-autoreact-ledger") {
      if (record.type === "artifact-comment-monitor") lastMonitor = record;
      else lastLedger = record;
      if (lastMonitor === undefined) continue;
      const artifacts = artifactWatchEntries(lastMonitor, lastLedger);
      // Both records are re-saved often; only a change in what is watched renders.
      const watchKey = JSON.stringify(artifacts);
      if (watchKey === lastArtifactWatchKey) continue;
      lastArtifactWatchKey = watchKey;
      if (artifacts.length === 0) continue;
      sessionLines.push({ type: "artifact-watch", artifacts, lineIndex });
      continue;
    }

    if (record.type === "queue-operation") {
      if (record.reason === "absorbed_mid_turn" && record.commandUuid !== undefined) {
        absorbedCommandUuids.add(record.commandUuid);
        const queuedLine = queuedCommandLines.get(record.commandUuid);
        if (queuedLine !== undefined) queuedLine.absorbedMidTurn = true;
      }
      continue;
    }

    if (record.type === "attachment") {
      const attachmentLine: z.infer<typeof AttachmentLineSchema> = {
        type: "attachment",
        attachmentJson: JSON.stringify(record.attachment),
        lineIndex,
      };
      if (record.rendered !== undefined) {
        attachmentLine.rendered = record.rendered.map((r) => r.content);
      }
      if (record.renderedInHumanTurn !== undefined) {
        attachmentLine.renderedInHumanTurn = record.renderedInHumanTurn.map((r) => r.content);
      }
      if (record.renderedRole !== undefined) attachmentLine.renderedRole = record.renderedRole;
      if (record.attachment.type === "queued_command" && record.attachment.source_uuid) {
        const commandUuid = record.attachment.source_uuid;
        if (absorbedCommandUuids.has(commandUuid)) attachmentLine.absorbedMidTurn = true;
        else queuedCommandLines.set(commandUuid, attachmentLine);
      }
      if (uuid !== undefined) attachmentLine.uuid = uuid;
      if (record.timestamp !== undefined) attachmentLine.timestamp = record.timestamp;
      if (sessionId !== undefined) attachmentLine.sessionId = sessionId;
      sessionLines.push(attachmentLine);
      continue;
    }

    if (record.type === "system") {
      const subtype = RenderedSystemSubtypeSchema.safeParse(record.subtype);
      if (!subtype.success) continue;
      // The input-echo half of a local command carries no commandRun; the
      // output half names the command, so render only that one.
      if (subtype.data === "local_command" && record.commandRun === undefined) continue;
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
      if (record.taskId !== undefined) systemLine.taskId = record.taskId;
      if (record.cron !== undefined) systemLine.cron = record.cron;
      if (record.prompt !== undefined) systemLine.prompt = record.prompt;
      if (record.taskKind !== undefined) systemLine.taskKind = record.taskKind;
      if (record.cronKind !== undefined) systemLine.cronKind = record.cronKind;
      if (record.noOpStreak !== undefined) systemLine.noOpStreak = record.noOpStreak;
      if (record.commandRun !== undefined) systemLine.commandRun = record.commandRun;
      if (record.url !== undefined) systemLine.url = record.url;
      if (uuid !== undefined) systemLine.uuid = uuid;
      if (record.timestamp !== undefined) systemLine.timestamp = record.timestamp;
      if (sessionId !== undefined) systemLine.sessionId = sessionId;
      sessionLines.push(systemLine);
      continue;
    }

    if (record.type === "worktree-state") {
      const ws = record.worktreeSession;
      if (ws === undefined || ws === null) continue;
      if (ws.worktreeBranch === undefined) continue;
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
    if (sessionId !== undefined) processedLine.sessionId = sessionId;
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
      if (record.queuePriority !== undefined) {
        processedLine.queuePriority = record.queuePriority;
      }
      if (record.turnOrigin !== undefined && record.turnOrigin !== "human") {
        processedLine.turnOrigin = record.turnOrigin;
      }
      if (record.scheduledTaskId !== undefined) {
        processedLine.scheduledTaskId = record.scheduledTaskId;
      }
      const classifier = record.serverClassifierContext?.context;
      if (classifier !== undefined) {
        const context: NonNullable<MessageProcessedLine["classifierContext"]> = {};
        if (classifier.live_cwd !== undefined) context.liveCwd = classifier.live_cwd;
        const branch = classifier.git_state?.branch;
        if (typeof branch === "string") context.branch = branch;
        if (classifier.platform !== undefined) context.platform = classifier.platform;
        processedLine.classifierContext = context;
      }
    }
    if (record.type === "assistant") {
      if (record.isApiErrorMessage === true) processedLine.isApiErrorMessage = true;
      if (record.apiErrorStatus !== undefined) processedLine.apiErrorStatus = record.apiErrorStatus;
      if (record.errorDetails !== undefined) processedLine.errorDetails = record.errorDetails;
      if (record.message.stop_reason === "max_tokens") processedLine.stopReason = "max_tokens";
      if (record.message.usage !== undefined) processedLine.usage = record.message.usage;
      if (typeof record.perTurnEffort === "string") {
        processedLine.perTurnEffort = record.perTurnEffort;
      }
      if (record.advisorModel !== undefined) processedLine.advisorModel = record.advisorModel;
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
 *
 * @param startLineIndex - JSONL record index of `records[0]`. The transcript
 *   endpoint serves a window over the tail of the file, so pass the window's
 *   `startIndex` to keep every `lineIndex` session-absolute. Message anchors
 *   are built from `lineIndex`, and an anchor has to survive the window
 *   boundary moving as the session grows.
 */
export function processTranscript(records: unknown[], startLineIndex = 0): ProcessedTranscript {
  const uuidToLine = new Map<string, number>();
  const { sessionLines, toolResults, title, customTitle } = processRecordBatch(
    records,
    startLineIndex,
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
