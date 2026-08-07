import { z } from "zod";
import type { SessionSummaryState } from "./session-state";
import {
  BashInputSchema,
  ReadInputSchema,
  EditInputSchema,
  MultiEditInputSchema,
  WriteInputSchema,
  GlobInputSchema,
  GrepInputSchema,
  AgentInputSchema,
  WebFetchInputSchema,
  TodoWriteInputSchema,
  ExitPlanModeInputSchema,
  AskUserQuestionInputSchema,
} from "./tool-input-schemas";
import { JsonValueSchema } from "./schemas";

// ---------------------------------------------------------------------------
// SSE Event Types
// ---------------------------------------------------------------------------

/**
 * Non-domain SSE event names that are not file-level deltas. Session lifecycle
 * (start/end) stays here because it carries server-side state transitions, and
 * the worktree / statusline / catch-all content events are not tied to any
 * domain entity diff. Everything that used to be a file-system-level event
 * (session:update, sessions:reindexed, task:updated, plan:updated,
 * memory:updated) now lives exclusively in DOMAIN_EVENTS below.
 */
export const SSE_EVENTS = {
  SESSION_START: "session:start",
  SESSION_END: "session:end",
  WORKTREE_CREATED: "worktree:created",
  WORKTREE_REMOVED: "worktree:removed",
  STATUSLINE_UPDATED: "statusline:updated",
  CONTENT_UPDATED: "content:updated",
} as const;

/** Events emitted by the process-wide herdr subscription bridge. */
export const HERDR_EVENTS = {
  PANES_SNAPSHOT: "herdr:panes-snapshot",
  PANE_CREATED: "herdr:pane-created",
  PANE_CLOSED: "herdr:pane-closed",
  PANE_UPDATED: "herdr:pane-updated",
  PANE_MOVED: "herdr:pane-moved",
  PANE_EXITED: "herdr:pane-exited",
  PANE_AGENT_DETECTED: "herdr:pane-agent-detected",
  PANE_AGENT_STATUS_CHANGED: "herdr:pane-agent-status-changed",
} as const;

/**
 * Domain-level delta events. Payloads carry the data needed to patch the
 * TanStack Query cache client-side without a refetch. The server is
 * responsible for diffing old vs new state and emitting these events.
 */
export const DOMAIN_EVENTS = {
  SESSION_ADDED: "session:added",
  SESSION_REMOVED: "session:removed",
  SESSION_UPDATED: "session:updated",
  SESSION_STARTED: "session:started",
  SESSION_ENDED: "session:ended",
  SESSION_LINES_APPENDED: "session:lines-appended",
  SESSION_PROMPT_SUBMITTED: "session:prompt-submitted",
  SESSION_HOOK_CONTEXT_CHANGED: "session:hook-context-changed",
  SESSION_TOOL_PENDING: "session:tool-pending",
  SESSION_TOOL_FAILED: "session:tool-failed",
  SESSION_COMPACTING: "session:compacting",
  SESSION_COMPACTED: "session:compacted",
  SUBAGENT_STARTED: "subagent:started",
  SUBAGENT_STOPPED: "subagent:stopped",
  SUBAGENTS_SNAPSHOT: "subagents:snapshot",
  SESSION_CWD_CHANGED: "session:cwd-changed",
  INSTRUCTIONS_LOADED: "instructions:loaded",
  CONFIG_CHANGED: "config:changed",
  MESSAGE_DISPLAYED: "message:displayed",
  NOTIFICATION: "notification",
  NOTIFICATION_ADDED: "notification:added",
  NOTIFICATION_CLEARED: "notification:cleared",
  PLAN_CHANGED: "plan:changed",
  PLAN_REMOVED: "plan:removed",
  MEMORY_CHANGED: "memory:changed",
  MEMORY_REMOVED: "memory:removed",
  TASK_CHANGED: "task:changed",
  TASK_CREATED: "task:created",
  TASK_COMPLETED: "task:completed",
  APPROVAL_CHANGED: "approval:changed",
  APPROVAL_RESOLVED: "approval:resolved",
  HOOK_SCHEMA_DRIFT: "hook:schema-drift",
  REVIEW_OFFERED: "review:offered",
} as const;

export interface ReviewOfferedPayload {
  sessionId: string;
}

/**
 * Payload broadcast when a hook event POSTed to /api/hook fails to parse
 * against `HookEventEnvelope`. Carries the offending event name, the set of
 * missing/unknown field paths derived from the Zod issue list, and the count
 * of how many times this exact (event_name, body_sha256) drift has been seen
 * on the server since startup.
 */
export interface HookSchemaDriftPayload {
  hookEventName: string;
  missingFields: string[];
  unknownFields: string[];
  count: number;
}

// ---------------------------------------------------------------------------
// SSE Event Payloads (sent to client)
// ---------------------------------------------------------------------------

/**
 * Summary payload for a single session, matching the serialized shape
 * emitted by the `/api/sessions` endpoint. Dates are ISO strings so payloads
 * survive JSON serialization to clients.
 */
export interface SessionSummaryPayload {
  id: string;
  title: string;
  summary: string | undefined;
  mtime: string;
  created: string;
  project: string;
  projectName: string;
  messageCount: number;
  gitBranch: string | undefined;
  starred: boolean;
  state: SessionSummaryState;
  blockedSince: string | null;
}

/**
 * Payload describing a session that is currently blocked waiting for the user
 * to answer an `ExitPlanMode` or `AskUserQuestion` tool call. `blockedSince` is
 * an ISO string so the payload survives JSON serialization to clients.
 */
export interface PendingApprovalPayload {
  sessionId: string;
  projectId: string;
  projectName: string;
  toolName: "ExitPlanMode" | "AskUserQuestion";
  toolUseId: string;
  blockedSince: string;
  planFilename: string | null;
  questionPreview: string | null;
}

/** Summary payload for a single plan, matching `/api/plans` output. */
export interface PlanSummaryPayload {
  filename: string;
  title: string;
  mtime: string;
}

/** Summary payload for a single memory file. */
export interface MemorySummaryPayload {
  filename: string;
  title: string;
  mtime: string;
  project: string;
  projectName: string;
}

/** Summary payload for a single task, matching the TaskRow shape. */
export interface TaskSummaryPayload {
  taskId: string;
  projectDir: string;
  subject: string;
  description: string;
  status: string;
  activeForm: string | null;
  owner: string | null;
  blocks: string[];
  blockedBy: string[];
}

/** Active session info for session:started — matches ActiveSession shape. */
export interface ActiveSessionPayload {
  sessionId: string;
  cwd: string;
  model: string;
  startedAt: number;
  lastActivity: number;
}

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface SessionLinesAppendedPayload {
  sessionId: string;
  lines: Record<string, JsonValue>[];
}

/**
 * Payload broadcast when a `UserPromptSubmit` hook fires. Lets the session view
 * render the user's message before the JSONL file has been flushed to disk.
 * `ts` is an ISO string so the payload survives JSON serialization.
 */
export interface SessionPromptSubmittedPayload {
  sessionId: string;
  prompt: string;
  ts: string;
}

export interface HookBackgroundTaskPayload {
  id: string;
  type: string;
  status: string;
  description: string;
  command?: string;
  agentType?: string;
  server?: string;
  tool?: string;
  name?: string;
}

export interface HookSessionCronPayload {
  id: string;
  schedule: string;
  recurring: boolean;
  prompt: string;
}

/** Live hook-only context that has not necessarily reached the JSONL yet. */
export interface SessionHookContextPayload {
  sessionId: string;
  sessionTitle?: string;
  promptId?: string;
  permissionMode?: string;
  effortLevel?: string;
  backgroundTasks?: HookBackgroundTaskPayload[];
  sessionCrons?: HookSessionCronPayload[];
}

/**
 * Payload broadcast when a `PreToolUse` hook fires. The UI uses this to show
 * an "in-flight" indicator for the tool call before the corresponding
 * `PostToolUse` event lands with the response body.
 */
export interface SessionToolPendingPayload {
  sessionId: string;
  toolName: string;
  toolUseId: string;
}

/**
 * Payload broadcast when a `PostToolUseFailure` hook fires. Symmetric with
 * `SessionToolPendingPayload`; the session view uses this to flag a specific
 * tool call as errored before the failure shows up via the JSONL watcher
 * (~2s later). `error` is the human-readable failure description Claude Code
 * attaches to the hook payload.
 */
export interface SessionToolFailedPayload {
  sessionId: string;
  toolName: string;
  toolUseId: string;
  error: string;
}

/**
 * Payload broadcast when a `Notification` hook fires. Surfaces in the
 * active-session indicator so the user sees Claude Code-issued notifications
 * (waiting for input, idle timeout, etc.) without polling.
 */
export interface NotificationPayload {
  sessionId: string;
  message: string;
  title: string | undefined;
}

/**
 * A single persisted notification entry, broadcast via `NOTIFICATION_ADDED`
 * when a `Notification` hook lands in the server-side notifications store.
 * Mirrors the store's `NotificationEntry` shape. `notificationType` is the
 * freeform discriminator from the hook (`agent_needs_input` / `agent_completed`
 * / unknown); the presentation layer classifies known kinds and degrades to
 * `message`/`title` otherwise. `createdAt` is epoch ms; `createdAtIso` is the
 * ISO form used for relative-time rendering after JSON serialization.
 */
export interface NotificationEntryPayload {
  id: string;
  sessionId: string;
  projectId: string;
  projectName: string;
  message: string;
  title: string | undefined;
  notificationType: string;
  createdAt: number;
  createdAtIso: string;
}

/**
 * Payload broadcast via `NOTIFICATION_CLEARED` when notifications are dismissed.
 * `id` targets a single entry (per-row dismiss); `all` signals a clear-all so
 * the client empties every notifications slice.
 */
export interface NotificationClearedPayload {
  id?: string;
  all?: boolean;
}

/**
 * Payload broadcast when a `PreCompact` hook fires. Lets the UI render a
 * "compaction in progress" state for the session until the compacted
 * transcript shows up via the watcher / next `Stop`.
 */
export interface SessionCompactingPayload {
  sessionId: string;
  trigger: "manual" | "auto" | undefined;
}

/**
 * Payload broadcast when a `PostCompact` hook fires. Symmetric with
 * `SessionCompactingPayload` — lets the UI clear the in-progress compacting
 * indicator that the prior `PreCompact` set. `reason` mirrors the
 * `PreCompact.trigger` vocabulary; `tokensRemoved` is the count Claude Code
 * reports for how much context the compaction freed.
 */
export interface SessionCompactedPayload {
  sessionId: string;
  reason: "manual" | "auto" | undefined;
  tokensRemoved: number | undefined;
}

/**
 * Payload broadcast when a `SubagentStart` hook fires. `sessionId` is the
 * parent session; `agentId` is the subagent session when Claude Code provides
 * it.
 */
export interface LiveSubagentPayload {
  sessionId: string;
  parentAgentId: string | null;
  agentType: string;
  agentId: string;
  description: string;
  startedAt: string;
  endedAt: string | null;
}

export type SubagentStartedPayload = LiveSubagentPayload;

export interface SubagentStoppedPayload {
  sessionId: string;
  agentType: string;
  agentId: string;
  endedAt?: string;
}

/**
 * Payload broadcast when a `CwdChanged` hook fires. Sessions in this viewer
 * are keyed by project (cwd), so mid-session cwd shifts are otherwise
 * invisible until the next JSONL flush. The active-session store's cwd is
 * updated via `markSessionActive` so the active-session sidebar re-homes the
 * session to the new project.
 */
export interface SessionCwdChangedPayload {
  sessionId: string;
  oldCwd: string;
  newCwd: string;
}

/**
 * Payload broadcast when an `InstructionsLoaded` hook fires. Records that
 * Claude Code loaded a CLAUDE.md or rules markdown file into the session
 * context. The viewer is a passive observer — the event is forwarded as an SSE
 * delta so a future "context loaded" panel can populate per-session without
 * polling. `loadReason` mirrors Claude Code's vocabulary
 * (`session_start` | `nested_traversal` | `path_glob_match` | `include` |
 * `compact`); `memoryType` distinguishes user/project/local layers.
 */
export interface InstructionsLoadedPayload {
  sessionId: string;
  filePath: string;
  memoryType: string | undefined;
  loadReason: string | undefined;
  globs: string[] | undefined;
  triggerFilePath: string | undefined;
  parentFilePath: string | undefined;
}

/**
 * Payload broadcast when a `ConfigChange` hook fires. Claude Code emits this
 * when a settings file changes during the session. `configSource` mirrors the
 * underlying field — `skills` (plugin manifests) causes the dispatcher to
 * additionally re-emit `CONTENT_UPDATED` so the plugins view refreshes.
 * `changedFields` is the list of dotted paths Claude Code reports as modified.
 */
export interface ConfigChangedPayload {
  sessionId: string;
  configSource: string;
  changedFields: string[];
}

/**
 * Payload broadcast when a `MessageDisplay` hook fires. Claude Code emits this
 * event as assistant message text streams to the terminal — other hooks can
 * transform or hide the displayed text via `hookSpecificOutput.displayContent`,
 * but the viewer is a passive observer and only forwards the event. The
 * `message` field carries whatever text Claude Code reports as the about-to-be
 * rendered assistant text (real payload shape is not yet documented; the
 * schema accepts the candidates we've observed so far and lets unknown fields
 * fall through to the schema-drift recovery path). `messageId` mirrors the
 * underlying assistant message uuid when Claude Code includes it.
 */
export interface MessageDisplayedPayload {
  sessionId: string;
  message: string | undefined;
  messageId: string | undefined;
}

// ---------------------------------------------------------------------------
// Diff helpers for domain-event broadcasting
// ---------------------------------------------------------------------------

/**
 * Diff two keyed maps of entities and return the added/removed/updated sets.
 * `equals` controls whether two entries with the same key count as "updated"
 * — defaults to strict `===` reference equality, which is almost never what
 * callers want; pass a value-level comparator.
 */
export function diffEntityMaps<T>(
  previous: ReadonlyMap<string, T>,
  next: ReadonlyMap<string, T>,
  equals: (a: T, b: T) => boolean = Object.is,
): { added: T[]; removed: string[]; updated: T[] } {
  const added: T[] = [];
  const removed: string[] = [];
  const updated: T[] = [];

  for (const [key, value] of next) {
    const prior = previous.get(key);
    if (prior === undefined) {
      added.push(value);
    } else if (!equals(prior, value)) {
      updated.push(value);
    }
  }

  for (const key of previous.keys()) {
    if (!next.has(key)) removed.push(key);
  }

  return { added, removed, updated };
}

// ---------------------------------------------------------------------------
// Claude Hook Event Schemas (received from hooks via POST /api/hook)
// ---------------------------------------------------------------------------

/**
 * Fields present on every hook event Claude Code sends. The docs ship
 * `session_id`, `transcript_path`, `cwd`, and `hook_event_name` on every event.
 * `claude_env` is the merged snapshot of CLAUDE-prefixed environment variables
 * the jq filter in `hook-config.ts` attaches to every payload before POSTing.
 */
const BaseHookFields = {
  session_id: z.string(),
  transcript_path: z.string(),
  cwd: z.string(),
  hook_event_name: z.string(),
  /** UUID correlating a user prompt with every event until the next prompt. */
  prompt_id: z.string().optional(),
  // Freeform for the same reason as `Notification.notification_type`: a strict
  // `z.enum` here rejects the entire envelope when a new mode ships, which
  // drops every session out of the active-session store. Claude Code itself
  // declares this field as a plain optional string.
  permission_mode: z.string().optional(),
  /** Present when the hook fires from inside a subagent. */
  agent_id: z.string().optional(),
  agent_type: z.string().optional(),
  /** Reasoning effort for the current turn, after any per-model downgrade. */
  effort: z.strictObject({ level: z.string() }).optional(),
  claude_env: z.record(z.string(), z.string()).optional(),
} as const;

/**
 * In-flight background work registered in the session, reported on `Stop` and
 * `SubagentStop` so hooks can tell "session is done" from "session is paused
 * waiting on background work". Shapes mirror Claude Code's own hook schemas.
 */
const BackgroundTaskSchema = z.strictObject({
  id: z.string(),
  type: z.string(),
  status: z.string(),
  description: z.string(),
  command: z.string().optional(),
  agent_type: z.string().optional(),
  server: z.string().optional(),
  tool: z.string().optional(),
  name: z.string().optional(),
});

/** Session-scoped crons (CronCreate, ScheduleWakeup, /loop) that wake it later. */
const SessionCronSchema = z.strictObject({
  id: z.string(),
  schedule: z.string(),
  recurring: z.boolean(),
  prompt: z.string(),
});

/** Fields both stop events carry alongside `stop_hook_active`. */
const StopSharedFields = {
  last_assistant_message: z.string().optional(),
  background_tasks: z.array(BackgroundTaskSchema).optional(),
  session_crons: z.array(SessionCronSchema).optional(),
} as const;

// ---------------------------------------------------------------------------
// Per-tool strict schemas for PostToolUse / PreToolUse discriminated union.
// Each entry pairs a strict `tool_input` with a strict `tool_response`. The
// response shapes are derived from the renderer types in
// `src/components/tool-renderers/types.ts` and the JSONL fixtures under
// `tests/fixtures/`.
// ---------------------------------------------------------------------------

const BashToolResponseSchema = z
  .object({
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    interrupted: z.boolean().optional(),
    isImage: z.boolean().optional(),
    sandbox: z.boolean().optional(),
    returnCodeInterpretation: z.string().optional(),
    /** Set when the command is expected to succeed silently. */
    noOutputExpected: z.boolean().optional(),
  })
  .strict();

const ReadToolResponseSchema = z
  .object({
    type: z.string().optional(),
    file: z
      .object({
        filePath: z.string().optional(),
        content: z.string().optional(),
        numLines: z.number().optional(),
        startLine: z.number().optional(),
        totalLines: z.number().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const EditToolResponseSchema = z
  .object({
    filePath: z.string().optional(),
    oldString: z.string().optional(),
    newString: z.string().optional(),
    originalFile: z.string().optional(),
    structuredPatch: z.array(JsonValueSchema).optional(),
    userModified: z.boolean().optional(),
    replaceAll: z.boolean().optional(),
  })
  .strict();

const MultiEditToolResponseSchema = z
  .object({
    filePath: z.string().optional(),
    edits: z.array(JsonValueSchema).optional(),
    originalFileContents: z.string().optional(),
    structuredPatch: z.array(JsonValueSchema).optional(),
    userModified: z.boolean().optional(),
  })
  .strict();

const WriteToolResponseSchema = z
  .object({
    type: z.string().optional(),
    filePath: z.string().optional(),
    content: z.string().optional(),
    structuredPatch: z.array(JsonValueSchema).optional(),
  })
  .strict();

const GlobToolResponseSchema = z
  .object({
    filenames: z.array(z.string()).optional(),
    durationMs: z.number().optional(),
    numFiles: z.number().optional(),
    truncated: z.boolean().optional(),
  })
  .strict();

const GrepToolResponseSchema = z
  .object({
    mode: z.string().optional(),
    filenames: z.array(z.string()).optional(),
    content: z.string().optional(),
    numFiles: z.number().optional(),
    numLines: z.number().optional(),
  })
  .strict();

const TaskToolResponseSchema = z
  .object({
    content: z.array(JsonValueSchema).optional(),
    totalTokens: z.number().optional(),
    totalToolUseCount: z.number().optional(),
    wasInterrupted: z.boolean().optional(),
  })
  .strict();

const WebFetchToolResponseSchema = z
  .object({
    url: z.string().optional(),
    bytes: z.number().optional(),
    code: z.number().optional(),
    codeText: z.string().optional(),
    result: z.string().optional(),
    durationMs: z.number().optional(),
  })
  .strict();

const TodoWriteToolResponseSchema = z
  .object({
    oldTodos: z.array(JsonValueSchema).optional(),
    newTodos: z.array(JsonValueSchema).optional(),
  })
  .strict();

const ExitPlanModeToolResponseSchema = z
  .object({
    plan: z.string().optional(),
    approved: z.boolean().optional(),
  })
  .strict();

const AskUserQuestionToolResponseSchema = z
  .object({
    answers: z.array(JsonValueSchema).optional(),
    answer: z.string().optional(),
  })
  .strict();

/**
 * Discriminated union over `tool_name` for every tool variant we render. Each
 * branch carries a strict `tool_input` and strict `tool_response`. New tools
 * are detected by the schema-drift recovery path in `routes/api/hook.ts` so
 * they fail loud instead of being silently accepted.
 */
export const ToolUseUnion = z.discriminatedUnion("tool_name", [
  z.strictObject({
    tool_name: z.literal("Bash"),
    tool_input: BashInputSchema,
    tool_response: BashToolResponseSchema.optional(),
  }),
  z.strictObject({
    tool_name: z.literal("Read"),
    tool_input: ReadInputSchema,
    tool_response: ReadToolResponseSchema.optional(),
  }),
  z.strictObject({
    tool_name: z.literal("Edit"),
    tool_input: EditInputSchema,
    tool_response: EditToolResponseSchema.optional(),
  }),
  z.strictObject({
    tool_name: z.literal("MultiEdit"),
    tool_input: MultiEditInputSchema,
    tool_response: MultiEditToolResponseSchema.optional(),
  }),
  z.strictObject({
    tool_name: z.literal("Write"),
    tool_input: WriteInputSchema,
    tool_response: WriteToolResponseSchema.optional(),
  }),
  z.strictObject({
    tool_name: z.literal("Glob"),
    tool_input: GlobInputSchema,
    tool_response: GlobToolResponseSchema.optional(),
  }),
  z.strictObject({
    tool_name: z.literal("Grep"),
    tool_input: GrepInputSchema,
    tool_response: GrepToolResponseSchema.optional(),
  }),
  z.strictObject({
    tool_name: z.literal("Task"),
    tool_input: AgentInputSchema,
    tool_response: TaskToolResponseSchema.optional(),
  }),
  z.strictObject({
    tool_name: z.literal("WebFetch"),
    tool_input: WebFetchInputSchema,
    tool_response: WebFetchToolResponseSchema.optional(),
  }),
  z.strictObject({
    tool_name: z.literal("TodoWrite"),
    tool_input: TodoWriteInputSchema,
    tool_response: TodoWriteToolResponseSchema.optional(),
  }),
  z.strictObject({
    tool_name: z.literal("ExitPlanMode"),
    tool_input: ExitPlanModeInputSchema,
    tool_response: ExitPlanModeToolResponseSchema.optional(),
  }),
  z.strictObject({
    tool_name: z.literal("AskUserQuestion"),
    tool_input: AskUserQuestionInputSchema,
    tool_response: AskUserQuestionToolResponseSchema.optional(),
  }),
]);

const SessionStartHookEvent = z.strictObject({
  ...BaseHookFields,
  hook_event_name: z.literal("SessionStart"),
  source: z.enum(["startup", "resume", "clear", "compact", "fork"]),
  model: z.string().optional(),
  session_title: z.string().optional(),
});

const SessionEndHookEvent = z.strictObject({
  ...BaseHookFields,
  hook_event_name: z.literal("SessionEnd"),
  reason: z.string().optional(),
});

const StopHookEvent = z.strictObject({
  ...BaseHookFields,
  hook_event_name: z.literal("Stop"),
  stop_hook_active: z.boolean().optional(),
  ...StopSharedFields,
});

const SubagentStopHookEvent = z.strictObject({
  ...BaseHookFields,
  hook_event_name: z.literal("SubagentStop"),
  stop_hook_active: z.boolean().optional(),
  agent_transcript_path: z.string().optional(),
  ...StopSharedFields,
});

/**
 * Symmetric with `SubagentStop` — fires when a subagent is spawned. The viewer
 * uses this to surface a "subagent running" state in the subagents view before
 * the matching `SubagentStop` lands. `agent_config` is a structured snapshot of
 * the spawn site's args (model, tool allowlist, system prompt); fields are
 * strictly enumerated so the schema-drift counter fires when Claude Code
 * extends the shape. `hook_specific_output.additionalContext` is Claude Code's
 * slot for injecting strings back into the subagent's turn — accepted but not
 * acted on (the viewer is a passive observer).
 */
const SubagentStartHookSpecificOutput = z
  .object({
    hookEventName: z.literal("SubagentStart").optional(),
    additionalContext: z.string().optional(),
  })
  .strict();

const SubagentStartAgentConfig = z
  .object({
    model: z.string().optional(),
    system_prompt: z.string().optional(),
    tools: z.array(z.string()).optional(),
    description: z.string().optional(),
  })
  .strict();

const SubagentStartHookEvent = z.strictObject({
  ...BaseHookFields,
  hook_event_name: z.literal("SubagentStart"),
  agent_type: z.string().optional(),
  agent_id: z.string().optional(),
  agent_config: SubagentStartAgentConfig.optional(),
  hook_specific_output: SubagentStartHookSpecificOutput.optional(),
});

const UserPromptSubmitHookEvent = z.strictObject({
  ...BaseHookFields,
  hook_event_name: z.literal("UserPromptSubmit"),
  prompt: z.string(),
  /** What drove the turn; absent for ordinary typed prompts. */
  source: z.enum(["user", "sdk", "system", "loop_wakeup", "schedule_wakeup"]).optional(),
});

const NotificationHookEvent = z.strictObject({
  ...BaseHookFields,
  hook_event_name: z.literal("Notification"),
  message: z.string(),
  title: z.string().optional(),
  // Freeform discriminator for background-agent notifications
  // (`agent_needs_input` / `agent_completed`). Must stay `z.string()`, never a
  // strict `z.enum` — the envelope is `safeParse`d, so an enum would reject any
  // unknown/future value and route the event to the schema-drift path, silently
  // dropping the notification exactly when a new kind ships. Known kinds are
  // classified in the presentation layer instead.
  notification_type: z.string().optional(),
});

const PreCompactHookEvent = z.strictObject({
  ...BaseHookFields,
  hook_event_name: z.literal("PreCompact"),
  trigger: z.enum(["manual", "auto"]).optional(),
  custom_instructions: z.string().optional(),
});

/**
 * Symmetric with `PreCompact` — fires after Claude Code finishes compacting
 * the session transcript. The viewer broadcasts a `SESSION_COMPACTED` domain
 * event so the UI can clear the in-progress compacting indicator that the
 * prior `PreCompact` set. `reason` mirrors `PreCompact.trigger`;
 * `tokens_removed` is the count Claude Code reports for how much context the
 * compaction freed.
 */
const PostCompactHookEvent = z.strictObject({
  ...BaseHookFields,
  hook_event_name: z.literal("PostCompact"),
  reason: z.enum(["manual", "auto"]).optional(),
  tokens_removed: z.number().optional(),
});

/**
 * Build a strict `PreToolUse` / `PostToolUse` variant union. The outer
 * `HookEventEnvelope` discriminates on `hook_event_name`, so we cannot keep a
 * nested `tool_name` discriminated union as a child of a single
 * `PreToolUse` / `PostToolUse` variant — `z.union` of these is the closest
 * strict alternative. Each option is a strict object that pins both
 * `hook_event_name` and `tool_name` to a literal.
 */
function buildToolUseEvent(eventName: "PreToolUse" | "PostToolUse") {
  const variants = ToolUseUnion.options.map((toolVariant) =>
    z.strictObject({
      ...BaseHookFields,
      hook_event_name: z.literal(eventName),
      tool_name: toolVariant.shape.tool_name,
      tool_use_id: z.string().optional(),
      tool_input: toolVariant.shape.tool_input,
      tool_response: toolVariant.shape.tool_response,
      /** Tool execution time; excludes permission-prompt and hook time. */
      duration_ms: z.number().optional(),
    }),
  );
  return z.union(variants as [(typeof variants)[number], ...typeof variants]);
}

const PreToolUseHookEvent = buildToolUseEvent("PreToolUse");
const PostToolUseHookEvent = buildToolUseEvent("PostToolUse");

/**
 * Build the `PostToolUseFailure` per-tool union. Symmetric with `PostToolUse`,
 * fired when a tool call fails instead of succeeding. Carries the failing
 * `tool_input`, an `error` description, an optional `tool_use_id`, and the
 * `hook_specific_output` slot Claude Code uses to inject `additionalContext`
 * / `systemMessage` strings into the next turn. The viewer is a passive
 * observer so we don't act on the injected strings, but we accept them so
 * the schema-drift counter doesn't fire on otherwise-valid payloads.
 */
const PostToolUseFailureHookSpecificOutput = z
  .object({
    hookEventName: z.literal("PostToolUseFailure").optional(),
    additionalContext: z.string().optional(),
    systemMessage: z.string().optional(),
  })
  .strict();

function buildPostToolUseFailureEvent() {
  const variants = ToolUseUnion.options.map((toolVariant) =>
    z.strictObject({
      ...BaseHookFields,
      hook_event_name: z.literal("PostToolUseFailure"),
      tool_name: toolVariant.shape.tool_name,
      tool_use_id: z.string().optional(),
      tool_input: toolVariant.shape.tool_input,
      error: z.string().optional(),
      hook_specific_output: PostToolUseFailureHookSpecificOutput.optional(),
    }),
  );
  return z.union(variants as [(typeof variants)[number], ...typeof variants]);
}

const PostToolUseFailureHookEvent = buildPostToolUseFailureEvent();

const TaskCompletedHookEvent = z.strictObject({
  ...BaseHookFields,
  hook_event_name: z.literal("TaskCompleted"),
  task_id: z.string().optional(),
  task_subject: z.string().optional(),
  task_description: z.string().optional(),
});

/**
 * Symmetric with `TaskCompleted` — fires when a `TaskCreate` tool runs. The
 * viewer broadcasts a `TASK_CREATED` domain event so the tasks page can update
 * the moment a task is created, before the `~/.claude/tasks/` JSON file edit
 * is picked up by the chokidar watcher (~2s later) or by the
 * `handlePostToolUseFileEdit` fast path. Field names mirror `TaskCompleted`
 * (`task_id`, `task_subject`, `task_description`) for consistency, even though
 * Claude Code's underlying tool input uses `task_name`.
 */
const TaskCreatedHookEvent = z.strictObject({
  ...BaseHookFields,
  hook_event_name: z.literal("TaskCreated"),
  task_id: z.string().optional(),
  task_subject: z.string().optional(),
  task_description: z.string().optional(),
});

const WorktreeCreateHookEvent = z.strictObject({
  ...BaseHookFields,
  hook_event_name: z.literal("WorktreeCreate"),
  name: z.string().optional(),
});

/**
 * Fires when the working directory changes mid-session (e.g. the user runs
 * `cd` via Bash). Sessions in this viewer are keyed by project (cwd), so
 * without this event a mid-session cwd shift is invisible until the next
 * JSONL flush. Strict schema from day one — unknown fields trigger the
 * schema-drift recovery path.
 */
const CwdChangedHookEvent = z.strictObject({
  ...BaseHookFields,
  hook_event_name: z.literal("CwdChanged"),
  old_cwd: z.string(),
  new_cwd: z.string(),
});

/**
 * Symmetric with `WorktreeCreate` — fires when a worktree is removed. The
 * viewer broadcasts `WORKTREE_REMOVED` so any worktree-aware UI can react in
 * real time. `worktree_path` is the absolute path Claude Code reports for the
 * removed worktree (mirrors the `worktree_path` field in the underlying tool
 * input). Strict schema from day one — unknown fields trigger schema drift.
 */
const WorktreeRemoveHookEvent = z.strictObject({
  ...BaseHookFields,
  hook_event_name: z.literal("WorktreeRemove"),
  worktree_path: z.string().optional(),
});

/**
 * Fires when Claude Code loads a CLAUDE.md or `.claude/rules/*.md` file into
 * the session context. Observability-only — the viewer just rebroadcasts the
 * event so a future per-session "context loaded" panel can render the loaded
 * instruction set. `load_reason` mirrors Claude Code's vocabulary
 * (`session_start`, `nested_traversal`, `path_glob_match`, `include`,
 * `compact`); `memory_type` distinguishes user / project / local layers.
 * Strict schema from day one — unknown fields trigger schema drift.
 */
const InstructionsLoadedHookEvent = z.strictObject({
  ...BaseHookFields,
  hook_event_name: z.literal("InstructionsLoaded"),
  file_path: z.string(),
  memory_type: z.string().optional(),
  load_reason: z
    .enum(["session_start", "nested_traversal", "path_glob_match", "include", "compact"])
    .optional(),
  globs: z.array(z.string()).optional(),
  trigger_file_path: z.string().optional(),
  parent_file_path: z.string().optional(),
});

/**
 * Fires when a configuration file changes during the session. The viewer's
 * plugins / skills view can go stale if `~/.claude/settings.json` is edited
 * mid-session — this event lets the dispatcher refresh the relevant UI without
 * waiting for the chokidar watcher. `config_source` is Claude Code's
 * vocabulary for which settings layer changed; `skills` corresponds to the
 * plugin manifests directory. `changed_fields` lists the dotted paths Claude
 * Code reports as modified. Strict schema from day one — unknown fields
 * trigger schema drift.
 */
const ConfigChangeHookEvent = z.strictObject({
  ...BaseHookFields,
  hook_event_name: z.literal("ConfigChange"),
  config_source: z.enum([
    "user_settings",
    "project_settings",
    "local_settings",
    "policy_settings",
    "skills",
  ]),
  changed_fields: z.array(z.string()).optional(),
});

/**
 * Fires while assistant message text streams to the terminal — other hooks
 * can transform or hide the displayed text via
 * `hookSpecificOutput.displayContent`. The viewer is a passive observer: it
 * forwards the event so the live session view can diff what the CLI actually
 * rendered against the JSONL transcript and surface hook-hidden text.
 *
 * The official input shape is not yet documented (this event lands in recent
 * Claude Code release notes but the hooks reference at code.claude.com still
 * lists only the common fields). The strict schema below captures the
 * candidates we expect to see on the wire — `message` for the about-to-render
 * text, `message_id` for the underlying assistant uuid — and leaves the
 * schema-drift recovery path in `src/routes/api/hook.ts` to surface anything
 * else so we can extend this with confidence.
 */
const MessageDisplayHookEvent = z.strictObject({
  ...BaseHookFields,
  hook_event_name: z.literal("MessageDisplay"),
  message: z.string().optional(),
  message_id: z.string().optional(),
  /** Streaming shape: one event per batch of newly completed lines. */
  turn_id: z.string().optional(),
  index: z.number().int().optional(),
  final: z.boolean().optional(),
  delta: z.string().optional(),
});

/**
 * Union over every hook event Claude Code can send. Each variant is a strict
 * object — unknown fields fail parsing and trigger the schema-drift recovery
 * path in `src/routes/api/hook.ts`. `PreToolUse` and `PostToolUse` are
 * themselves unions over per-tool strict variants (see `ToolUseUnion`).
 *
 * The outer discriminator (`hook_event_name`) cannot be expressed via
 * `z.discriminatedUnion` because the `PreToolUse` / `PostToolUse` arms are
 * already discriminated unions (Zod's discriminatedUnion only accepts plain
 * object schemas). `z.union` matches the same set of payloads and still emits
 * useful per-arm errors.
 */
export const HookEventEnvelope = z.union([
  SessionStartHookEvent,
  SessionEndHookEvent,
  StopHookEvent,
  SubagentStartHookEvent,
  SubagentStopHookEvent,
  UserPromptSubmitHookEvent,
  NotificationHookEvent,
  PreCompactHookEvent,
  PostCompactHookEvent,
  PreToolUseHookEvent,
  PostToolUseHookEvent,
  PostToolUseFailureHookEvent,
  TaskCreatedHookEvent,
  TaskCompletedHookEvent,
  WorktreeCreateHookEvent,
  WorktreeRemoveHookEvent,
  CwdChangedHookEvent,
  InstructionsLoadedHookEvent,
  ConfigChangeHookEvent,
  MessageDisplayHookEvent,
]);

export type HookEvent = z.infer<typeof HookEventEnvelope>;
export type HookEventName = HookEvent["hook_event_name"];

/**
 * The set of hook event names handled by the receiver, derived directly from
 * the discriminated union above so there's no second list to keep in sync.
 * Each variant declares `hook_event_name: z.literal('...')` — we read that
 * literal back out of the schema definition. `PreToolUse` / `PostToolUse` are
 * `ZodIntersection`s so we hand-list them; everything else is read from the
 * strict envelope.
 */
export const KNOWN_HOOK_EVENTS: readonly HookEventName[] = [
  "SessionStart",
  "SessionEnd",
  "Stop",
  "SubagentStart",
  "SubagentStop",
  "UserPromptSubmit",
  "Notification",
  "PreCompact",
  "PostCompact",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "TaskCreated",
  "TaskCompleted",
  "WorktreeCreate",
  "WorktreeRemove",
  "CwdChanged",
  "InstructionsLoaded",
  "ConfigChange",
  "MessageDisplay",
];
