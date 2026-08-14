import { z } from "zod";
import { isMcpTool, toolInputSchemas } from "./tool-input-schemas";

// ---------------------------------------------------------------------------
// JSON value
// ---------------------------------------------------------------------------

/**
 * Recursive schema for any valid JSON value. Used in place of `z.unknown()` for
 * externally-owned API objects (Anthropic `usage`, `container`, etc.) so we
 * assert "valid JSON" (rejecting undefined/functions/symbols) without breaking
 * when the upstream shape gains new fields.
 */
export const JsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

// ---------------------------------------------------------------------------
// Sessions Index (sessions-index.json)
// ---------------------------------------------------------------------------

export const SessionIndexEntrySchema = z
  .object({
    sessionId: z.string(),
    fullPath: z.string(),
    fileMtime: z.number(),
    firstPrompt: z.string().optional(),
    summary: z.string().optional(),
    messageCount: z.number().optional(),
    created: z.string().optional(),
    modified: z.string().optional(),
    gitBranch: z.string().optional(),
    projectPath: z.string().optional(),
    isSidechain: z.boolean().optional(),
  })
  .strict();

export const SessionsIndexSchema = z
  .object({
    version: z.number(),
    entries: z.array(SessionIndexEntrySchema),
    originalPath: z.string().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Content Blocks (inside user/assistant messages)
// ---------------------------------------------------------------------------

export const TextBlockSchema = z
  .object({
    type: z.literal("text"),
    text: z.string(),
  })
  .strict();

export const ToolUseBlockSchema = z
  .object({
    type: z.literal("tool_use"),
    id: z.string(),
    name: z.string(),
    input: z.record(z.string(), JsonValueSchema),
    caller: z.union([z.string(), z.record(z.string(), JsonValueSchema)]).optional(),
  })
  .strict();

export const ThinkingBlockSchema = z
  .object({
    type: z.literal("thinking"),
    thinking: z.string(),
    signature: z.string().optional(),
  })
  .strict();

export const ToolResultBlockSchema = z
  .object({
    type: z.literal("tool_result"),
    tool_use_id: z.string(),
    content: z.union([z.string(), z.array(JsonValueSchema)]).optional(),
    is_error: z.boolean().optional(),
  })
  .strict();

const ImageBlockSchema = z
  .object({
    type: z.literal("image"),
    source: z
      .object({
        type: z.string(),
        media_type: z.string(),
        data: z.string(),
      })
      .strict(),
  })
  .strict();

const DocumentBlockSchema = z
  .object({
    type: z.literal("document"),
    source: z
      .object({
        type: z.string(),
        media_type: z.string(),
        data: z.string(),
      })
      .strict(),
  })
  .strict();

export const ContentBlockSchema = z
  .discriminatedUnion("type", [
    TextBlockSchema,
    ToolUseBlockSchema,
    ThinkingBlockSchema,
    ToolResultBlockSchema,
    ImageBlockSchema,
    DocumentBlockSchema,
  ])
  .superRefine((block, ctx) => {
    if (block.type !== "tool_use") return;

    const { name, input } = block;

    if (isMcpTool(name)) return;

    const schema = toolInputSchemas[name as keyof typeof toolInputSchemas];
    if (!schema) return;

    const result = schema.safeParse(input);
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({
          ...issue,
          path: ["input", ...issue.path],
        });
      }
    }
  });

// ---------------------------------------------------------------------------
// JSONL Record Types
// ---------------------------------------------------------------------------

// Shared fields present on most JSONL records (user, assistant, progress, system, attachment)
const BaseRecordFields = {
  uuid: z.string().optional(),
  timestamp: z.string().optional(),
  sessionId: z.string().optional(),
  session_id: z.string().optional(),
  parentUuid: z.union([z.string(), z.null()]).optional(),
  isSidechain: z.boolean().optional(),
  userType: z.string().optional(),
  cwd: z.string().optional(),
  gitBranch: z.string().optional(),
  slug: z.string().optional(),
  version: z.string().optional(),
  entrypoint: z.string().optional(),
  forkedFrom: z.union([z.string(), z.record(z.string(), JsonValueSchema)]).optional(),
  teamName: z.string().optional(),
  leafUuid: z.string().optional(),
  agentId: z.string().optional(),
  sessionKind: z.string().optional(),
  // Agent type that produced the record, e.g. "Explore" or "git:commit-handler".
  // Written on subagent transcripts only.
  attributionAgent: z.string().optional(),
};

export const PromptSourceSchema = z.enum(["typed", "system", "sdk", "queued"]);

export const UserRecordSchema = z
  .object({
    type: z.literal("user"),
    ...BaseRecordFields,
    message: z
      .object({
        role: z.literal("user"),
        content: z.union([z.string(), z.array(ContentBlockSchema)]),
      })
      .strict(),
    toolUseResult: JsonValueSchema.optional(),
    toolDenialKind: z.string().optional(),
    sourceToolAssistantUUID: z.string().optional(),
    sourceToolUseID: z.string().optional(),
    promptId: z.string().optional(),
    permissionMode: z.string().optional(),
    promptSource: PromptSourceSchema.optional(),
    queuePriority: z.literal("later").optional(),
    imagePasteIds: z.array(z.union([z.string(), z.number()])).optional(),
    isMeta: z.boolean().optional(),
    isCompactSummary: z.boolean().optional(),
    isVisibleInTranscriptOnly: z.boolean().optional(),
    mcpMeta: z.record(z.string(), JsonValueSchema).optional(),
    origin: z.union([z.string(), z.record(z.string(), JsonValueSchema)]).optional(),
    interruptedMessageId: z.string().optional(),
    interruptedByShutdown: z.boolean().optional(),
    userFeedback: z.string().optional(),
  })
  .strict();

export const AssistantRecordSchema = z
  .object({
    type: z.literal("assistant"),
    ...BaseRecordFields,
    requestId: z.string().optional(),
    effort: z.string().optional(),
    message: z
      .object({
        role: z.literal("assistant"),
        model: z.string().optional(),
        id: z.string().optional(),
        type: z.string().optional(),
        content: z.union([z.string(), z.array(ContentBlockSchema)]),
        stop_reason: z.union([z.string(), z.null()]).optional(),
        stop_sequence: z.union([z.string(), z.null()]).optional(),
        usage: z.record(z.string(), JsonValueSchema).optional(),
        stop_details: z.union([z.record(z.string(), JsonValueSchema), z.null()]).optional(),
        container: z.union([z.record(z.string(), JsonValueSchema), z.null()]).optional(),
        context_management: z.union([z.record(z.string(), JsonValueSchema), z.null()]).optional(),
        diagnostics: z
          .union([z.array(JsonValueSchema), z.record(z.string(), JsonValueSchema), z.null()])
          .optional(),
      })
      .strict(),
    isApiErrorMessage: z.boolean().optional(),
    apiErrorStatus: z.union([z.number(), z.string()]).optional(),
    error: z.union([z.string(), z.record(z.string(), JsonValueSchema)]).optional(),
    attributionSkill: z.string().optional(),
    attributionPlugin: z.string().optional(),
    attributionMcpServer: z.string().optional(),
    attributionMcpTool: z.string().optional(),
    errorDetails: z.union([z.string(), z.record(z.string(), JsonValueSchema)]).optional(),
    healsDistinctCarrier: z.boolean().optional(),
    isAbortedMidStream: z.boolean().optional(),
  })
  .strict();

export const CustomTitleRecordSchema = z
  .object({
    type: z.literal("custom-title"),
    customTitle: z.string(),
    sessionId: z.string(),
  })
  .strict();

export const FileHistorySnapshotSchema = z
  .object({
    type: z.literal("file-history-snapshot"),
    messageId: z.string().optional(),
    isSnapshotUpdate: z.boolean().optional(),
    snapshot: z
      .object({
        messageId: z.string().optional(),
        timestamp: z.string().optional(),
        trackedFileBackups: z.record(z.string(), JsonValueSchema),
      })
      .strict(),
  })
  .strict();

const ForkContextRefRecordSchema = z
  .object({
    type: z.literal("fork-context-ref"),
    agentId: z.string(),
    parentSessionId: z.string(),
    parentLastUuid: z.string(),
    contextLength: z.number().int().nonnegative(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Attachment sub-types (discriminated on attachment.type)
// ---------------------------------------------------------------------------

const PlanModeAttachmentPayload = z
  .object({
    type: z.literal("plan_mode"),
    planFilePath: z.string().optional(),
    reminderType: z.string().optional(),
    isSubAgent: z.boolean().optional(),
    planExists: z.boolean().optional(),
  })
  .strict();

const PlanModeExitAttachmentPayload = z
  .object({
    type: z.literal("plan_mode_exit"),
    planFilePath: z.string().optional(),
    planExists: z.boolean().optional(),
  })
  .strict();

const PlanModeReentryAttachmentPayload = z
  .object({
    type: z.literal("plan_mode_reentry"),
    planFilePath: z.string().optional(),
    planExists: z.boolean().optional(),
  })
  .strict();

// Fields shared by all hook attachment payloads
const HookBaseFields = {
  hookName: z.string(),
  toolUseID: z.string().optional(),
  hookEvent: z.string(),
};

const HookSuccessAttachmentPayload = z
  .object({
    type: z.literal("hook_success"),
    ...HookBaseFields,
    content: z.string().optional(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    exitCode: z.number().optional(),
    command: z.string().optional(),
    durationMs: z.number().optional(),
  })
  .strict();

const HookNonBlockingErrorAttachmentPayload = z
  .object({
    type: z.literal("hook_non_blocking_error"),
    ...HookBaseFields,
    stderr: z.string().optional(),
    stdout: z.string().optional(),
    exitCode: z.number().optional(),
    command: z.string().optional(),
    durationMs: z.number().optional(),
  })
  .strict();

const HookBlockingErrorAttachmentPayload = z
  .object({
    type: z.literal("hook_blocking_error"),
    ...HookBaseFields,
    blockingError: z.record(z.string(), JsonValueSchema).optional(),
    command: z.string().optional(),
    durationMs: z.number().optional(),
  })
  .strict();

const HookCancelledAttachmentPayload = z
  .object({
    type: z.literal("hook_cancelled"),
    ...HookBaseFields,
    command: z.string().optional(),
    durationMs: z.number().optional(),
    timedOut: z.boolean().optional(),
    timeoutMs: z.number().optional(),
  })
  .strict();

const HookSystemMessageAttachmentPayload = z
  .object({
    type: z.literal("hook_system_message"),
    ...HookBaseFields,
    content: z.union([z.string(), z.array(JsonValueSchema)]).optional(),
  })
  .strict();

const HookAdditionalContextAttachmentPayload = z
  .object({
    type: z.literal("hook_additional_context"),
    ...HookBaseFields,
    content: z.union([z.string(), z.array(JsonValueSchema)]).optional(),
  })
  .strict();

const AsyncHookResponseAttachmentPayload = z
  .object({
    type: z.literal("async_hook_response"),
    processId: z.string(),
    hookName: z.string(),
    hookEvent: z.string(),
    response: z.record(z.string(), JsonValueSchema).optional(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    exitCode: z.number().optional(),
  })
  .strict();

const DeferredToolsDeltaAttachmentPayload = z
  .object({
    type: z.literal("deferred_tools_delta"),
    addedNames: z.array(z.string()).optional(),
    addedLines: z.array(z.string()).optional(),
    removedNames: z.array(z.string()).optional(),
    readdedNames: z.array(z.string()).optional(),
    pendingMcpServers: z.array(z.string()).optional(),
    needsAuthMcpServers: z.array(z.string()).optional(),
  })
  .strict();

const AgentListingDeltaAttachmentPayload = z
  .object({
    type: z.literal("agent_listing_delta"),
    addedTypes: z.array(z.string()).optional(),
    addedLines: z.array(z.string()).optional(),
    removedTypes: z.array(z.string()).optional(),
    isInitial: z.boolean().optional(),
    showConcurrencyNote: z.boolean().optional(),
  })
  .strict();

const McpInstructionsDeltaAttachmentPayload = z
  .object({
    type: z.literal("mcp_instructions_delta"),
    addedNames: z.array(z.string()).optional(),
    addedBlocks: z.array(z.string()).optional(),
    removedNames: z.array(z.string()).optional(),
  })
  .strict();

const SkillListingAttachmentPayload = z
  .object({
    type: z.literal("skill_listing"),
    content: z.string().optional(),
    skillCount: z.number().optional(),
    isInitial: z.boolean().optional(),
    names: z.array(z.string()).optional(),
  })
  .strict();

const DynamicSkillAttachmentPayload = z
  .object({
    type: z.literal("dynamic_skill"),
    skillDir: z.string().optional(),
    skillNames: z.array(z.string()).optional(),
    displayPath: z.string().optional(),
  })
  .strict();

// Fields shared by task/todo reminder payloads
const ReminderBaseFields = {
  content: z.union([z.string(), z.array(JsonValueSchema)]).optional(),
  itemCount: z.number().optional(),
};

const TaskReminderAttachmentPayload = z
  .object({ type: z.literal("task_reminder"), ...ReminderBaseFields })
  .strict();

const TaskStatusAttachmentPayload = z
  .object({
    type: z.literal("task_status"),
    taskId: z.string(),
    taskType: z.string().optional(),
    description: z.string().optional(),
    status: z.string(),
    deltaSummary: z.union([z.string(), z.null()]).optional(),
    outputFilePath: z.string().optional(),
  })
  .strict();

const TodoReminderAttachmentPayload = z
  .object({ type: z.literal("todo_reminder"), ...ReminderBaseFields })
  .strict();

const TotalTokensReminderAttachmentPayload = z
  .object({
    type: z.literal("total_tokens_reminder"),
    text: z.string(),
  })
  .strict();

const EditedTextFileAttachmentPayload = z
  .object({
    type: z.literal("edited_text_file"),
    filename: z.string(),
    snippet: z.string().optional(),
    displayPath: z.string().optional(),
  })
  .strict();

const FileAttachmentPayload = z
  .object({
    type: z.literal("file"),
    filename: z.string(),
    content: z.union([z.string(), z.record(z.string(), JsonValueSchema)]).optional(),
    displayPath: z.string().optional(),
  })
  .strict();

const AlreadyReadFileAttachmentPayload = z
  .object({
    type: z.literal("already_read_file"),
    filename: z.string(),
    content: z.union([z.string(), z.record(z.string(), JsonValueSchema)]).optional(),
    displayPath: z.string().optional(),
  })
  .strict();

const DirectoryAttachmentPayload = z
  .object({
    type: z.literal("directory"),
    path: z.string().optional(),
    content: z.string().optional(),
    displayPath: z.string().optional(),
  })
  .strict();

const CompactFileReferenceAttachmentPayload = z
  .object({
    type: z.literal("compact_file_reference"),
    filename: z.string().optional(),
    displayPath: z.string().optional(),
  })
  .strict();

const ReadTruncationNoticeAttachmentPayload = z
  .object({
    type: z.literal("read_truncation_notice"),
    banner: z.string(),
    toolUseID: z.string().optional(),
  })
  .strict();

const DateChangeAttachmentPayload = z
  .object({
    type: z.literal("date_change"),
    newDate: z.string(),
  })
  .strict();

const CommandPermissionsAttachmentPayload = z
  .object({
    type: z.literal("command_permissions"),
    allowedTools: z.array(JsonValueSchema).optional(),
    model: z.string().optional(),
  })
  .strict();

const DiagnosticsAttachmentPayload = z
  .object({
    type: z.literal("diagnostics"),
    files: z.array(JsonValueSchema).optional(),
    isNew: z.boolean().optional(),
  })
  .strict();

const QueuedCommandAttachmentPayload = z
  .object({
    type: z.literal("queued_command"),
    prompt: z.union([z.string(), z.array(JsonValueSchema)]).optional(),
    commandMode: z.string().optional(),
    imagePasteIds: z.array(z.union([z.string(), z.number()])).optional(),
    origin: z.union([z.string(), z.record(z.string(), JsonValueSchema)]).optional(),
    timestamp: z.string().optional(),
    isMeta: z.boolean().optional(),
  })
  .strict();

const SelectedLinesInIdeAttachmentPayload = z
  .object({
    type: z.literal("selected_lines_in_ide"),
    ideName: z.string().optional(),
    lineStart: z.number().optional(),
    lineEnd: z.number().optional(),
    filename: z.string().optional(),
    content: z.string().optional(),
    displayPath: z.string().optional(),
  })
  .strict();

const OpenedFileInIdeAttachmentPayload = z
  .object({
    type: z.literal("opened_file_in_ide"),
    filename: z.string().optional(),
  })
  .strict();

const CompanionIntroAttachmentPayload = z
  .object({
    type: z.literal("companion_intro"),
    name: z.string().optional(),
    species: z.string().optional(),
  })
  .strict();

const InvokedSkillsAttachmentPayload = z
  .object({
    type: z.literal("invoked_skills"),
    skills: z.array(JsonValueSchema).optional(),
  })
  .strict();

const UltrathinkEffortAttachmentPayload = z
  .object({
    type: z.literal("ultrathink_effort"),
    level: z.string().optional(),
  })
  .strict();

const MaxTurnsReachedAttachmentPayload = z
  .object({
    type: z.literal("max_turns_reached"),
    maxTurns: z.number().optional(),
    turnCount: z.number().optional(),
  })
  .strict();

const AutoModeAttachmentPayload = z
  .object({
    type: z.literal("auto_mode"),
    reminderType: z.string().optional(),
    autoModeConsentFlow: z.boolean().optional(),
    bashFirst: z.boolean().optional(),
    steerOnly: z.boolean().optional(),
    bypass: z.boolean().optional(),
  })
  .strict();

const WorkflowKeywordRequestAttachmentPayload = z
  .object({
    type: z.literal("workflow_keyword_request"),
  })
  .strict();

const AutoModeExitAttachmentPayload = z
  .object({
    type: z.literal("auto_mode_exit"),
  })
  .strict();

const PlanFileReferenceAttachmentPayload = z
  .object({
    type: z.literal("plan_file_reference"),
    planFilePath: z.string().optional(),
    planContent: z.string().optional(),
  })
  .strict();

const NestedMemoryAttachmentPayload = z
  .object({
    type: z.literal("nested_memory"),
    path: z.string().optional(),
    content: z.record(z.string(), JsonValueSchema).optional(),
    displayPath: z.string().optional(),
  })
  .strict();

const TeamContextAttachmentPayload = z
  .object({
    type: z.literal("team_context"),
    agentId: z.string().optional(),
    agentName: z.string().optional(),
    teamName: z.string().optional(),
    teamConfigPath: z.string().optional(),
    taskListPath: z.string().optional(),
  })
  .strict();

export const AttachmentPayloadSchema = z.discriminatedUnion("type", [
  PlanModeAttachmentPayload,
  AutoModeAttachmentPayload,
  AutoModeExitAttachmentPayload,
  PlanFileReferenceAttachmentPayload,
  NestedMemoryAttachmentPayload,
  PlanModeExitAttachmentPayload,
  PlanModeReentryAttachmentPayload,
  HookSuccessAttachmentPayload,
  HookNonBlockingErrorAttachmentPayload,
  HookBlockingErrorAttachmentPayload,
  HookCancelledAttachmentPayload,
  HookSystemMessageAttachmentPayload,
  HookAdditionalContextAttachmentPayload,
  AsyncHookResponseAttachmentPayload,
  DeferredToolsDeltaAttachmentPayload,
  AgentListingDeltaAttachmentPayload,
  McpInstructionsDeltaAttachmentPayload,
  SkillListingAttachmentPayload,
  DynamicSkillAttachmentPayload,
  TaskReminderAttachmentPayload,
  TaskStatusAttachmentPayload,
  TodoReminderAttachmentPayload,
  TotalTokensReminderAttachmentPayload,
  EditedTextFileAttachmentPayload,
  FileAttachmentPayload,
  AlreadyReadFileAttachmentPayload,
  DirectoryAttachmentPayload,
  CompactFileReferenceAttachmentPayload,
  ReadTruncationNoticeAttachmentPayload,
  DateChangeAttachmentPayload,
  CommandPermissionsAttachmentPayload,
  DiagnosticsAttachmentPayload,
  QueuedCommandAttachmentPayload,
  SelectedLinesInIdeAttachmentPayload,
  OpenedFileInIdeAttachmentPayload,
  CompanionIntroAttachmentPayload,
  InvokedSkillsAttachmentPayload,
  UltrathinkEffortAttachmentPayload,
  MaxTurnsReachedAttachmentPayload,
  WorkflowKeywordRequestAttachmentPayload,
  TeamContextAttachmentPayload,
]);

/**
 * Attachment record: uses discriminated union on attachment.type
 * for all the different attachment payloads.
 */
export const AttachmentRecordSchema = z
  .object({
    type: z.literal("attachment"),
    ...BaseRecordFields,
    attachment: AttachmentPayloadSchema,
  })
  .strict();

export const ProgressRecordSchema = z
  .object({
    type: z.literal("progress"),
    ...BaseRecordFields,
    data: z.record(z.string(), JsonValueSchema).optional(),
    toolUseID: z.string().optional(),
    parentToolUseID: z.string().optional(),
  })
  .strict();

export const CompactMetadataSchema = z
  .object({
    trigger: z.enum(["auto", "manual"]),
    preTokens: z.number(),
    postTokens: z.number().optional(),
    durationMs: z.number().optional(),
    preCompactDiscoveredTools: z.array(z.string()).optional(),
    cumulativeDroppedTokens: z.number().optional(),
    preservedSegment: z
      .object({
        headUuid: z.string(),
        anchorUuid: z.string(),
        tailUuid: z.string(),
      })
      .strict()
      .optional(),
    preservedMessages: z
      .object({
        anchorUuid: z.string(),
        uuids: z.array(z.string()),
        allUuids: z.array(z.string()),
      })
      .strict()
      .optional(),
  })
  .strict();

export const SystemRecordSchema = z
  .object({
    type: z.literal("system"),
    ...BaseRecordFields,
    subtype: z.string().optional(),
    durationMs: z.number().optional(),
    content: z.string().optional(),
    level: z.string().optional(),
    isMeta: z.boolean().optional(),
    toolUseID: z.string().optional(),
    sourceToolUseID: z.string().optional(),
    hookCount: z.number().optional(),
    hookInfos: z.array(JsonValueSchema).optional(),
    hookErrors: z.array(JsonValueSchema).optional(),
    hookAdditionalContext: z.array(JsonValueSchema).optional(),
    preventedContinuation: z.boolean().optional(),
    preventContinuation: z.boolean().optional(),
    stopReason: z.string().optional(),
    hasOutput: z.boolean().optional(),
    error: z.union([z.string(), z.record(z.string(), JsonValueSchema)]).optional(),
    messageCount: z.number().optional(),
    pendingBackgroundAgentCount: z.number().optional(),
    pendingWorkflowCount: z.number().optional(),
    promptId: z.string().optional(),
    permissionMode: z.string().optional(),
    logicalParentUuid: z.string().optional(),
    cause: z.union([z.string(), z.record(z.string(), JsonValueSchema)]).optional(),
    compactMetadata: CompactMetadataSchema.optional(),
    retryAttempt: z.number().optional(),
    retryInMs: z.number().optional(),
    maxRetries: z.number().optional(),
    source: z.string().optional(),
  })
  .strict();

const AiTitleRecordSchema = z
  .object({
    type: z.literal("ai-title"),
    aiTitle: z.string(),
    sessionId: z.string(),
  })
  .strict();

export const LastPromptRecordSchema = z
  .object({
    type: z.literal("last-prompt"),
    lastPrompt: z.string().optional(),
    leafUuid: z.string().optional(),
    explicit: z.boolean().optional(),
    sessionId: z.string(),
  })
  .strict();

export const QueueOperationRecordSchema = z
  .object({
    type: z.literal("queue-operation"),
    operation: z.string(),
    timestamp: z.string().optional(),
    sessionId: z.string().optional(),
    content: z.string().optional(),
  })
  .strict();

const AgentNameRecordSchema = z
  .object({
    type: z.literal("agent-name"),
    agentName: z.string(),
    sessionId: z.string(),
  })
  .strict();

const AgentSettingRecordSchema = z
  .object({
    type: z.literal("agent-setting"),
    agentSetting: z.string(),
    sessionId: z.string(),
  })
  .strict();

const AgentColorRecordSchema = z
  .object({
    type: z.literal("agent-color"),
    agentColor: z.string(),
    sessionId: z.string(),
  })
  .strict();

const PermissionModeRecordSchema = z
  .object({
    type: z.literal("permission-mode"),
    permissionMode: z.string(),
    sessionId: z.string(),
  })
  .strict();

const WorktreeSessionSchema = z
  .object({
    originalCwd: z.string(),
    preEnterOriginalCwd: z.string().optional(),
    worktreePath: z.string(),
    worktreeName: z.string(),
    worktreeBranch: z.string().optional(),
    sessionId: z.string(),
    originalBranch: z.string().optional(),
    originalHeadCommit: z.string().optional(),
    enteredExisting: z.boolean().optional(),
    hookBased: z.boolean().optional(),
  })
  .strict()
  .superRefine((session, context) => {
    if (session.worktreeBranch === undefined && session.hookBased !== true) {
      context.addIssue({
        code: "custom",
        path: ["worktreeBranch"],
        message: "Required for non-hook worktree sessions",
      });
    }
  });

const RelocatedRecordSchema = z
  .object({
    type: z.literal("relocated"),
    sessionId: z.string(),
    relocatedCwd: z.string(),
  })
  .strict();

const WorktreeStateRecordSchema = z
  .object({
    type: z.literal("worktree-state"),
    worktreeSession: z.union([WorktreeSessionSchema, z.null()]).optional(),
    sessionId: z.string().optional(),
  })
  .strict();

const PrLinkRecordSchema = z
  .object({
    type: z.literal("pr-link"),
    prUrl: z.string(),
    prNumber: z.number(),
    prRepository: z.string(),
    sessionId: z.string(),
    timestamp: z.string().optional(),
  })
  .strict();

const ModeRecordSchema = z
  .object({
    type: z.literal("mode"),
    mode: z.string(),
    sessionId: z.string(),
  })
  .strict();

/**
 * Discriminated union of all known JSONL record types.
 * Unknown record types are hard errors -- they mean we need a new schema branch.
 */
export const JsonlRecordSchema = z.discriminatedUnion("type", [
  UserRecordSchema,
  AssistantRecordSchema,
  CustomTitleRecordSchema,
  FileHistorySnapshotSchema,
  ForkContextRefRecordSchema,
  AttachmentRecordSchema,
  ProgressRecordSchema,
  SystemRecordSchema,
  AiTitleRecordSchema,
  LastPromptRecordSchema,
  QueueOperationRecordSchema,
  AgentNameRecordSchema,
  AgentSettingRecordSchema,
  AgentColorRecordSchema,
  PermissionModeRecordSchema,
  WorktreeStateRecordSchema,
  RelocatedRecordSchema,
  PrLinkRecordSchema,
  ModeRecordSchema,
]);

// ---------------------------------------------------------------------------
// Task Files (~/.claude/tasks/{project}/{id}.json)
// ---------------------------------------------------------------------------

export const TaskStatusSchema = z.enum(["pending", "in_progress", "completed"]);

export const TaskFileSchema = z
  .object({
    id: z.string(),
    subject: z.string(),
    description: z.string(),
    status: TaskStatusSchema,
    blocks: z.array(z.string()),
    blockedBy: z.array(z.string()),
    activeForm: z.string().optional(),
    owner: z.string().optional(),
    metadata: z.record(z.string(), JsonValueSchema).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Claude Code Settings (~/.claude/settings.json, settings.local.json)
// ---------------------------------------------------------------------------

const HookCommonFields = {
  if: z.string().optional(),
  timeout: z.number().optional(),
  statusMessage: z.string().optional(),
  once: z.boolean().optional(),
};

const HookEntrySchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("command"),
      command: z.string(),
      args: z.array(z.string()).optional(),
      async: z.boolean().optional(),
      asyncRewake: z.boolean().optional(),
      shell: z.enum(["bash", "powershell"]).optional(),
      ...HookCommonFields,
    })
    .strict(),
  z
    .object({
      type: z.literal("http"),
      url: z.string(),
      headers: z.record(z.string(), z.string()).optional(),
      allowedEnvVars: z.array(z.string()).optional(),
      ...HookCommonFields,
    })
    .strict(),
]);

const HookMatcherSchema = z
  .object({
    matcher: z.string().optional(),
    hooks: z.array(HookEntrySchema),
  })
  .strict();

const HooksSchema = z.record(z.string(), z.array(HookMatcherSchema));

const PermissionsSchema = z
  .object({
    allow: z.array(z.string()).optional(),
    deny: z.array(z.string()).optional(),
    ask: z.array(z.string()).optional(),
    defaultMode: z.string().optional(),
    additionalDirectories: z.array(z.string()).optional(),
    disableBypassPermissionsMode: z.string().optional(),
  })
  .strict();

const StatusLineSchema = z
  .object({
    type: z.string().optional(),
    command: z.string().optional(),
    padding: z.number().optional(),
    refreshInterval: z.number().min(1).optional(),
    hideVimModeIndicator: z.boolean().optional(),
  })
  .strict();

const MarketplaceSourceSchema = z
  .object({
    source: z.string(),
    repo: z.string().optional(),
    path: z.string().optional(),
    url: z.string().optional(),
  })
  .strict();

const MarketplaceEntrySchema = z
  .object({
    source: MarketplaceSourceSchema,
    autoUpdate: z.boolean().optional(),
    url: z.string().optional(),
  })
  .strict();

const SandboxSchema = z
  .object({
    enabled: z.boolean().optional(),
    autoAllowBashIfSandboxed: z.boolean().optional(),
  })
  .strict();

const RemoteSchema = z
  .object({
    defaultEnvironmentId: z.string().optional(),
  })
  .strict();

const WorktreeSettingsSchema = z
  .object({
    baseRef: z.string().optional(),
    bgIsolation: z.string().optional(),
  })
  .strict();

export const ClaudeSettingsSchema = z
  .object({
    $schema: z.string().optional(),
    model: z.string().optional(),
    theme: z.string().optional(),
    tui: z.string().optional(),
    verbose: z.boolean().optional(),
    includeCoAuthoredBy: z.boolean().optional(),
    includeGitInstructions: z.boolean().optional(),
    alwaysThinkingEnabled: z.boolean().optional(),
    autoCompactEnabled: z.boolean().optional(),
    voiceEnabled: z.boolean().optional(),
    cleanupPeriodDays: z.number().optional(),
    fileCheckpointingEnabled: z.boolean().optional(),
    autoUpdatesChannel: z.string().optional(),
    enableAllProjectMcpServers: z.boolean().optional(),
    enabledMcpjsonServers: z.array(z.string()).optional(),
    skipDangerousModePermissionPrompt: z.boolean().optional(),
    skipWorkflowUsageWarning: z.boolean().optional(),
    teammateMode: z.string().optional(),
    preferredNotifChannel: z.string().optional(),
    outputStyle: z.string().optional(),
    spinnerTipsEnabled: z.boolean().optional(),
    skillOverrides: z.record(z.string(), z.string()).optional(),
    effortLevel: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
    permissions: PermissionsSchema.optional(),
    hooks: HooksSchema.optional(),
    statusLine: StatusLineSchema.optional(),
    sandbox: SandboxSchema.optional(),
    remote: RemoteSchema.optional(),
    worktree: WorktreeSettingsSchema.optional(),
    additionalDirectories: z.array(z.string()).optional(),
    enabledPlugins: z.record(z.string(), z.boolean()).optional(),
    extraKnownMarketplaces: z.record(z.string(), MarketplaceEntrySchema).optional(),
    spinnerVerbs: z
      .object({
        mode: z.string().optional(),
        verbs: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// MCP Configuration (~/.claude/mcp.json, .mcp.json)
// ---------------------------------------------------------------------------

const McpServerEntrySchema = z
  .object({
    type: z.string().optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    cwd: z.string().optional(),
    url: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export const McpConfigSchema = z
  .object({
    mcpServers: z.record(z.string(), McpServerEntrySchema),
  })
  .strict();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AttachmentPayload = z.infer<typeof AttachmentPayloadSchema>;
export type ToolUseBlock = z.infer<typeof ToolUseBlockSchema>;
type JsonlRecord = z.infer<typeof JsonlRecordSchema>;

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Parse a single JSONL line into a typed record.
 * Returns null for empty/malformed lines.
 */
export function parseJsonlRecord(line: string): JsonlRecord | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const result = JsonlRecordSchema.safeParse(obj);
  if (!result.success) return null;
  return result.data;
}
