import type { z } from "zod";
import type { PluginFileSchema, PluginListResponse } from "./api/plugins";
import type { SessionSummaryStateSchema } from "./api/sessions";
import type { SourceFileResponse } from "./api/source";
import type { HookEvent, ToolUseUnion } from "./hook-events";
import type {
  AttachmentPayloadSchema,
  ContentBlockSchema,
  JsonlRecordSchema,
  TaskStatusSchema,
  UserRecordSchema,
} from "./schemas";
import type { MessageProcessedLine, ProcessedLine } from "./transcript";

/**
 * Registry of every enumerable "choice" in the Zod schemas (enum values,
 * discriminated-union variants). `tests/schema-choices.test.ts` walks the
 * schema trees and fails when a choice node on a schema is missing here or
 * when an entry here goes stale — so adding a value to any schema enum or a
 * variant to any union breaks the build until it is registered (and, where a
 * designated exhaustive handler exists, handled).
 *
 * Each map is typed with `satisfies Record<...>` over the inferred schema
 * type, so a new choice is ALSO a compile error here even before tests run.
 * Enum maps carry display labels usable by the UI; union variant maps carry
 * `true` because their real handling lives at the designated exhaustive
 * consumer (assertNever switch) noted per map.
 */

type PromptSource = NonNullable<z.infer<typeof UserRecordSchema>["promptSource"]>;
type HookEventOf<Name extends HookEvent["hook_event_name"]> = Extract<
  HookEvent,
  { hook_event_name: Name }
>;

export const promptSourceLabels = {
  typed: "Typed",
  system: "System",
  sdk: "SDK",
  queued: "Queued",
} satisfies Record<PromptSource, string>;

const taskStatusLabels = {
  pending: "Pending",
  in_progress: "In progress",
  completed: "Completed",
} satisfies Record<z.infer<typeof TaskStatusSchema>, string>;

const sessionSummaryStateLabels = {
  idle: "Idle",
  working: "Working",
  waiting: "Waiting",
  unknown: "Unknown",
  ended: "Ended",
} satisfies Record<z.infer<typeof SessionSummaryStateSchema>, string>;

const sessionStartSourceLabels = {
  startup: "Startup",
  resume: "Resume",
  clear: "Clear",
  compact: "Compact",
  fork: "Fork",
} satisfies Record<HookEventOf<"SessionStart">["source"], string>;

const userPromptSourceLabels = {
  user: "User",
  sdk: "SDK",
  system: "System",
  loop_wakeup: "Loop wakeup",
  schedule_wakeup: "Schedule wakeup",
} satisfies Record<NonNullable<HookEventOf<"UserPromptSubmit">["source"]>, string>;

const compactTriggerLabels = {
  manual: "Manual",
  auto: "Auto",
} satisfies Record<NonNullable<HookEventOf<"PreCompact">["trigger"]>, string>;

const instructionsLoadReasonLabels = {
  session_start: "Session start",
  nested_traversal: "Nested traversal",
  path_glob_match: "Path glob match",
  include: "Include",
  compact: "Compact",
} satisfies Record<NonNullable<HookEventOf<"InstructionsLoaded">["load_reason"]>, string>;

const configChangeSourceLabels = {
  user_settings: "User settings",
  project_settings: "Project settings",
  local_settings: "Local settings",
  policy_settings: "Policy settings",
  skills: "Skills",
} satisfies Record<HookEventOf<"ConfigChange">["config_source"], string>;

const sourceLanguageLabels = {
  markdown: "Markdown",
  json: "JSON",
} satisfies Record<NonNullable<z.infer<typeof SourceFileResponse>>["language"], string>;

const pluginFileTypeLabels = {
  agent: "Agent",
  command: "Command",
  skill: "Skill",
  reference: "Reference",
  example: "Example",
} satisfies Record<z.infer<typeof PluginFileSchema>["type"], string>;

const pluginVersionKindLabels = {
  commit: "Commit",
  release: "Release",
} satisfies Record<z.infer<typeof PluginListResponse>[number]["versionKind"], string>;

const systemSubtypeLabels = {
  compact_boundary: "Compaction",
  stop_hook_summary: "Stop hooks",
  api_error: "API error",
  turn_duration: "Turn duration",
} satisfies Record<Extract<ProcessedLine, { type: "system" }>["subtype"], string>;

const messageLineTypeLabels = {
  user: "User",
  assistant: "Assistant",
} satisfies Record<MessageProcessedLine["type"], string>;

/** Exhaustive handler: switch in src/components/attachment-banner.tsx. */
const attachmentVariants = {
  plan_mode: true,
  plan_mode_exit: true,
  plan_mode_reentry: true,
  hook_success: true,
  hook_non_blocking_error: true,
  hook_blocking_error: true,
  hook_cancelled: true,
  hook_system_message: true,
  hook_additional_context: true,
  async_hook_response: true,
  deferred_tools_delta: true,
  agent_listing_delta: true,
  mcp_instructions_delta: true,
  skill_listing: true,
  dynamic_skill: true,
  task_reminder: true,
  task_status: true,
  todo_reminder: true,
  edited_text_file: true,
  file: true,
  already_read_file: true,
  directory: true,
  compact_file_reference: true,
  read_truncation_notice: true,
  date_change: true,
  command_permissions: true,
  diagnostics: true,
  queued_command: true,
  selected_lines_in_ide: true,
  opened_file_in_ide: true,
  companion_intro: true,
  invoked_skills: true,
  ultrathink_effort: true,
  max_turns_reached: true,
  auto_mode: true,
  auto_mode_exit: true,
  workflow_keyword_request: true,
  plan_file_reference: true,
  nested_memory: true,
} satisfies Record<z.infer<typeof AttachmentPayloadSchema>["type"], true>;

/** Consumed selectively (text extraction etc.) — no single exhaustive handler. */
const contentBlockVariants = {
  text: true,
  tool_use: true,
  thinking: true,
  tool_result: true,
  image: true,
  document: true,
} satisfies Record<z.infer<typeof ContentBlockSchema>["type"], true>;

/** Consumed selectively in src/lib/transcript.ts and src/lib/db/indexer.ts. */
const jsonlRecordVariants = {
  user: true,
  assistant: true,
  "custom-title": true,
  "file-history-snapshot": true,
  attachment: true,
  progress: true,
  system: true,
  "ai-title": true,
  "last-prompt": true,
  "queue-operation": true,
  "agent-name": true,
  "agent-setting": true,
  "agent-color": true,
  "permission-mode": true,
  "worktree-state": true,
  relocated: true,
  "pr-link": true,
  mode: true,
} satisfies Record<z.infer<typeof JsonlRecordSchema>["type"], true>;

/** Exhaustive handler: renderSessionMessage switch in src/components/session-chat.tsx. */
const renderedLineVariants = {
  user: true,
  assistant: true,
  "agent-name": true,
  "agent-color": true,
  "permission-mode": true,
  "pr-link": true,
  attachment: true,
  system: true,
  worktree: true,
} satisfies Record<ProcessedLine["type"], true>;

/** Exhaustive handler: switch in src/lib/hook-dispatcher.ts. */
const hookEventNames = {
  SessionStart: true,
  SessionEnd: true,
  Stop: true,
  SubagentStart: true,
  SubagentStop: true,
  UserPromptSubmit: true,
  Notification: true,
  PreCompact: true,
  PostCompact: true,
  PreToolUse: true,
  PostToolUse: true,
  PostToolUseFailure: true,
  TaskCreated: true,
  TaskCompleted: true,
  WorktreeCreate: true,
  WorktreeRemove: true,
  CwdChanged: true,
  InstructionsLoaded: true,
  ConfigChange: true,
  MessageDisplay: true,
} satisfies Record<HookEvent["hook_event_name"], true>;

/** Per-tool strict input/response variants; see buildToolUseUnion in hook-events.ts. */
const toolNames = {
  Bash: true,
  Read: true,
  Edit: true,
  MultiEdit: true,
  Write: true,
  Glob: true,
  Grep: true,
  Task: true,
  WebFetch: true,
  TodoWrite: true,
  ExitPlanMode: true,
  AskUserQuestion: true,
} satisfies Record<z.infer<typeof ToolUseUnion>["tool_name"], true>;

/** Maps walker path keys (see tests/schema-choices.test.ts) to choice maps. */
export const schemaChoiceRegistry: Record<string, Record<string, string | true>> = {
  TaskStatusSchema: taskStatusLabels,
  SessionSummaryStateSchema: sessionSummaryStateLabels,
  ContentBlockSchema: contentBlockVariants,
  AttachmentPayloadSchema: attachmentVariants,
  "UserRecordSchema.promptSource": promptSourceLabels,
  JsonlRecordSchema: jsonlRecordVariants,
  RenderedLineSchema: renderedLineVariants,
  "RenderedLineSchema.<assistant|user>.type": messageLineTypeLabels,
  "RenderedLineSchema.<system>.subtype": systemSubtypeLabels,
  "JsonlRecordSchema.<system>.compactMetadata.trigger": compactTriggerLabels,
  ToolUseUnion: toolNames,
  HookEventEnvelope: hookEventNames,
  "HookEventEnvelope.<SessionStart>.source": sessionStartSourceLabels,
  "HookEventEnvelope.<UserPromptSubmit>.source": userPromptSourceLabels,
  "HookEventEnvelope.<PreCompact>.trigger": compactTriggerLabels,
  "HookEventEnvelope.<PostCompact>.reason": compactTriggerLabels,
  "HookEventEnvelope.<InstructionsLoaded>.load_reason": instructionsLoadReasonLabels,
  "HookEventEnvelope.<ConfigChange>.config_source": configChangeSourceLabels,
  "HookEventEnvelope.<PreToolUse>": toolNames,
  "HookEventEnvelope.<PostToolUse>": toolNames,
  "HookEventEnvelope.<PostToolUseFailure>": toolNames,
  "SourceFileResponse.language": sourceLanguageLabels,
  "PluginFileSchema.type": pluginFileTypeLabels,
  "PluginListResponse[].versionKind": pluginVersionKindLabels,
};
