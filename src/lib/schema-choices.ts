import type { z } from "zod";
import type {
  ArtifactActionSchema,
  ArtifactAutoOpenSchema,
  ArtifactDbOpSchema,
  ArtifactIntentSchema,
  ArtifactListScopeSchema,
  ArtifactLiveSubscriptionSchema,
} from "./artifact-schemas";
import type { ChangedFileKindSchema } from "./changed-file-kind";
import type { CodeThemeDark, CodeThemeLight } from "./code-themes";
import type { TerminalAppearance } from "./terminal-theme";
import type { McpScopeSchema, PermissionBehaviorSchema, SkillSourceSchema } from "./api/customize";
import type { PluginFileSchema, PluginListResponse } from "./api/plugins";
import type {
  UnifiedSearchDateSchema,
  UnifiedSearchKindSchema,
  UnifiedSearchTypeSchema,
} from "./api/search";
import type { SessionSummaryStateSchema } from "./api/sessions";
import type { SourceFileResponse } from "./api/source";
import type { GroupColorSchema, GroupIconSchema } from "./group-appearance";
import type { HookEvent, ToolUseUnion } from "./hook-events";
import type { HomeAttentionKindSchema } from "./home-attention";
import type { NavSection } from "./nav-sections";
import type { PinDropOutcome } from "./pinned-sessions";
import type { PaletteFilter, PaletteType } from "./palette-tokens";
import type { Direction, LayoutNode, PaneKind, TileId } from "./pane-layout";
import type {
  AttachmentPayloadSchema,
  ClaudeSettingsSchema,
  ContentBlockSchema,
  GitBranchActionSchema,
  GitCommitKindSchema,
  GitPrActionSchema,
  JsonlRecordSchema,
  SkillOverrideValueSchema,
  TaskStatusSchema,
  UserRecordSchema,
  WriteToolUseResultTypeSchema,
} from "./schemas";
import type {
  SessionActivityDaysSchema,
  SessionGroupBySchema,
  SessionSortBySchema,
  SessionStatusFilterSchema,
} from "./session-groups";
import type {
  SessionBucketReasonSchema,
  SessionBucketSchema,
  SessionStateKindSchema,
} from "./session-state";
import type { SessionMenuItemIdSchema } from "./session-menu-items";
import type { SettingsTab } from "./settings-hash";
import type { MessageProcessedLine, ProcessedLine } from "./transcript";
import type { RecentKind } from "./recents-history";
import type {
  RoutineKind,
  RoutineScheduleFilter,
  RoutineSort,
  RoutineStatus,
  RoutineStatusFilter,
} from "./routines";
import type { TranscriptMode } from "./transcript-mode";
import type {
  ExitWorktreeActionSchema,
  RemoteTriggerActionSchema,
  ReportFindingsVerdictSchema,
} from "./tool-input-schemas";

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
type ClaudeHook = NonNullable<
  z.infer<typeof ClaudeSettingsSchema>["hooks"]
>[string][number]["hooks"][number];
type ClaudeCommandHook = Extract<ClaudeHook, { type: "command" }>;
type HookEventOf<Name extends HookEvent["hook_event_name"]> = Extract<
  HookEvent,
  { hook_event_name: Name }
>;

export const promptSourceLabels = {
  typed: "Typed",
  system: "System",
  sdk: "SDK",
  queued: "Queued",
  suggestion_accepted: "Suggestion accepted",
} satisfies Record<PromptSource, string>;

const taskStatusLabels = {
  pending: "Pending",
  in_progress: "In progress",
  completed: "Completed",
} satisfies Record<z.infer<typeof TaskStatusSchema>, string>;

const writeToolUseResultTypeLabels = {
  create: "Created",
  update: "Updated",
} satisfies Record<z.infer<typeof WriteToolUseResultTypeSchema>, string>;

/** Bash row verbs for `toolUseResult.gitOperation`, used by `toolLabel`. */
export const gitCommitKindLabels = {
  committed: "Committed",
  amended: "Amended commit",
  "cherry-picked": "Cherry-picked",
} satisfies Record<z.infer<typeof GitCommitKindSchema>, string>;

export const gitBranchActionLabels = {
  rebased: "Rebased onto",
  merged: "Merged",
} satisfies Record<z.infer<typeof GitBranchActionSchema>, string>;

export const gitPrActionLabels = {
  created: "Created PR",
  edited: "Edited PR",
  commented: "Commented on PR",
  ready: "Marked PR ready",
  merged: "Merged PR",
  closed: "Closed PR",
} satisfies Record<z.infer<typeof GitPrActionSchema>, string>;

const sessionSummaryStateLabels = {
  idle: "Idle",
  working: "Working",
  waiting: "Waiting",
  unknown: "Unknown",
  ended: "Ended",
} satisfies Record<z.infer<typeof SessionSummaryStateSchema>, string>;

/** Upstream claude.ai/code sidebar group names. */
export const sessionBucketLabels = {
  blocked: "Needs input",
  review: "Ready for review",
  working: "Working",
  done: "Completed",
} satisfies Record<z.infer<typeof SessionBucketSchema>, string>;

/** Home "Sessions" action-center pills (src/lib/home-attention.ts). */
export const homeAttentionKindLabels = {
  blocked: "Needs input",
  review: "Ready for review",
} satisfies Record<z.infer<typeof HomeAttentionKindSchema>, string>;

/** Filter & group menu options (src/lib/session-groups.ts); local "Project" is upstream "Folder". */
export const sessionGroupByLabels = {
  date: "Date",
  project: "Project",
  state: "State",
  custom: "Custom groups",
  none: "None",
} satisfies Record<z.infer<typeof SessionGroupBySchema>, string>;

/** Section header icon choices (src/lib/group-appearance.ts). */
export const groupIconLabels = {
  folder: "Folder",
  star: "Star",
  heart: "Heart",
  flag: "Flag",
  bookmark: "Bookmark",
  zap: "Bolt",
  code: "Code",
  bug: "Bug",
  rocket: "Rocket",
  book: "Book",
  briefcase: "Briefcase",
  home: "Home",
} satisfies Record<z.infer<typeof GroupIconSchema>, string>;

/** Section header color choices (src/lib/group-appearance.ts). */
export const groupColorLabels = {
  gray: "Gray",
  red: "Red",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  teal: "Teal",
  blue: "Blue",
  purple: "Purple",
  pink: "Pink",
} satisfies Record<z.infer<typeof GroupColorSchema>, string>;

export const sessionSortByLabels = {
  name: "Name",
  created: "Date created",
  activity: "Last activity",
} satisfies Record<z.infer<typeof SessionSortBySchema>, string>;

export const sessionStatusFilterLabels = {
  active: "Active",
  archived: "Archived",
  all: "All",
} satisfies Record<z.infer<typeof SessionStatusFilterSchema>, string>;

export const sessionActivityDaysLabels = {
  "1d": "1d",
  "3d": "3d",
  "7d": "7d",
  "30d": "30d",
  all: "All",
} satisfies Record<z.infer<typeof SessionActivityDaysSchema>, string>;

const sessionBucketReasonLabels = {
  ended: "Session ended",
  "pending-input": "Waiting on input",
  waiting: "Waiting on a question",
  error: "Error",
  "main-working": "Working",
  "live-agents": "Subagents running",
  "background-tasks": "Background tasks running",
  "subagent-activity": "Recent subagent activity",
  "herdr-working": "Working in herdr",
  "recent-file": "Transcript recently updated",
  "pull-request": "Open pull request",
  unseen: "Unseen work",
  idle: "Idle",
  "stale-file": "Transcript not recently updated",
} satisfies Record<z.infer<typeof SessionBucketReasonSchema>, string>;

/** Default accessible labels of the upstream row icons (src/components/status-dot.tsx). */
export const sessionStateKindLabels = {
  awaiting: "Awaiting input",
  running: "Running",
  ready: "Ready",
  error: "Error",
  pr: "Pull request",
  idle: "Idle",
} satisfies Record<z.infer<typeof SessionStateKindSchema>, string>;

export const unifiedSearchTypeLabels = {
  all: "All",
  sessions: "Sessions",
  plans: "Plans",
  memories: "Memories",
  files: "Files",
} satisfies Record<z.infer<typeof UnifiedSearchTypeSchema>, string>;

const unifiedSearchDateLabels = {
  today: "Today",
  week: "Past week",
  month: "Past month",
} satisfies Record<z.infer<typeof UnifiedSearchDateSchema>, string>;

const unifiedSearchKindLabels = {
  session: "Session",
  plan: "Plan",
  memory: "Memory",
  file: "File",
} satisfies Record<z.infer<typeof UnifiedSearchKindSchema>, string>;

export const paletteTypeLabels = {
  all: "All",
  sessions: "Sessions",
  plans: "Plans",
  memories: "Memories",
  files: "Files",
  projects: "Projects",
} satisfies Record<PaletteType, string>;

export const paletteFilterLabels = {
  project: "Project",
  date: "Date",
  repo: "Repo",
  type: "Type",
} satisfies Record<PaletteFilter, string>;

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

const skillSourceLabels = {
  personal: "Personal",
  project: "Project",
  plugin: "Plugin",
} satisfies Record<z.infer<typeof SkillSourceSchema>, string>;

const mcpScopeLabels = {
  user: "User",
  local: "Local",
  project: "Project",
  plugin: "Plugin",
} satisfies Record<z.infer<typeof McpScopeSchema>, string>;

const permissionBehaviorLabels = {
  allow: "Always allow",
  ask: "Needs approval",
  deny: "Blocked",
} satisfies Record<z.infer<typeof PermissionBehaviorSchema>, string>;

const claudeHookVariants = {
  command: true,
  http: true,
} satisfies Record<ClaudeHook["type"], true>;

const claudeHookShellLabels = {
  bash: "Bash",
  powershell: "PowerShell",
} satisfies Record<NonNullable<ClaudeCommandHook["shell"]>, string>;

const skillOverrideLabels = {
  on: "On",
  "name-only": "Name only",
  "user-invocable-only": "User-invocable only",
  off: "Off",
} satisfies Record<z.infer<typeof SkillOverrideValueSchema>, string>;

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
  total_tokens_reminder: true,
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
  team_context: true,
  bash_output_audience_note: true,
  batching_reminder_sent: true,
  credential_org: true,
  date: true,
  deferred_tools_record: true,
  environment: true,
  fork_briefing: true,
  hook_permission_decision: true,
  instructions: true,
  model: true,
  output_style: true,
  output_style_instructions: true,
  prompt_snapshot: true,
  remote_session_change: true,
  session_context: true,
  silent_turn_reminder: true,
  thinking_drop: true,
  thinking_stripped: true,
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
  "fork-context-ref": true,
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
  "atis-latch": true,
  "bridge-session": true,
  "cost-state": true,
  "frame-link": true,
  "artifact-comment-monitor": true,
  "artifact-autoreact-ledger": true,
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
  unparsed: true,
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
  Agent: true,
  WebFetch: true,
  Skill: true,
  TaskCreate: true,
  TaskUpdate: true,
  TaskGet: true,
  TaskList: true,
  AskUserQuestion: true,
  ExitPlanMode: true,
  EnterPlanMode: true,
  ToolSearch: true,
  TodoWrite: true,
  WebSearch: true,
  SendMessage: true,
  TaskStop: true,
  TaskOutput: true,
  Monitor: true,
  CronCreate: true,
  CronDelete: true,
  CronList: true,
  TeamCreate: true,
  TeamDelete: true,
  ScheduleWakeup: true,
  EnterWorktree: true,
  ExitWorktree: true,
  LSP: true,
  NotebookEdit: true,
  NotebookRead: true,
  ReportFindings: true,
  LS: true,
  Artifact: true,
  RemoteTrigger: true,
  SendUserFile: true,
  PushNotification: true,
  Workflow: true,
} satisfies Record<z.infer<typeof ToolUseUnion>["tool_name"], true>;

/** Side-pane tile kinds of the session pane host (src/lib/pane-layout.ts); labels match upstream pane titles. */
const paneKindLabels = {
  files: "Files",
  links: "Links",
  changes: "Changes",
  terminal: "Terminal",
  "background-tasks": "Background tasks",
  plan: "Plan",
  artifacts: "Artifacts",
  subagents: "Subagents",
} satisfies Record<PaneKind, string>;

const tileIdLabels = {
  chat: "Chat",
  ...paneKindLabels,
} satisfies Record<TileId, string>;

const paneStackDirectionLabels = {
  row: "Row",
  column: "Column",
} satisfies Record<Direction, string>;

/** Consumed by the pane-layout reducers in src/lib/pane-layout.ts. */
const paneLayoutNodeVariants = {
  tile: true,
  stack: true,
} satisfies Record<LayoutNode["kind"], true>;

/** Changes pane file kinds (src/lib/changed-file-kind.ts); non-source labels are upstream's section headings. */
export const changedFileKindLabels = {
  source: "Source files",
  test: "Test files",
  build: "Build files",
  generated: "Generated files",
} satisfies Record<z.infer<typeof ChangedFileKindSchema>, string>;

/** Settings dialog nav labels, in nav order. */
export const settingsTabLabels = {
  general: "General",
  usage: "Usage",
  "claude-code": "Claude Code",
  transcript: "Transcript",
  sessions: "Sessions",
  application: "Application",
  "ai-features": "AI features",
  "claude-config": "Claude Config",
  setup: "Setup",
} satisfies Record<SettingsTab, string>;

/** Settings ▸ Code appearance light themes (src/lib/code-themes.ts), named as on claude.ai/code. */
export const codeThemeLightLabels = {
  "claude-light": "Claude Light",
  "github-light": "GitHub Light",
  "pierre-light": "Pierre Light",
  "one-light": "One Light",
  "catppuccin-latte": "Catppuccin Latte",
  "solarized-light": "Solarized Light",
  "vitesse-light": "Vitesse Light",
  "min-light": "Min Light",
  "rose-pine-dawn": "Rosé Pine Dawn",
  "slack-ochin": "Slack Ochin",
} satisfies Record<CodeThemeLight, string>;

/** Settings ▸ Code appearance dark themes (src/lib/code-themes.ts), named as on claude.ai/code. */
export const codeThemeDarkLabels = {
  "github-dark": "GitHub Dark",
  "github-dark-dimmed": "GitHub Dark Dimmed",
  "pierre-dark": "Pierre Dark",
  "one-dark-pro": "One Dark Pro",
  dracula: "Dracula",
  "dracula-soft": "Dracula Soft",
  "catppuccin-mocha": "Catppuccin Mocha",
  nord: "Nord",
  "solarized-dark": "Solarized Dark",
  "vitesse-dark": "Vitesse Dark",
  "min-dark": "Min Dark",
  monokai: "Monokai",
  "tokyo-night": "Tokyo Night",
  "night-owl": "Night Owl",
  "rose-pine": "Rosé Pine",
  "ayu-dark": "Ayu Dark",
  "slack-dark": "Slack Dark",
} satisfies Record<CodeThemeDark, string>;

/** Settings ▸ Code appearance ▸ Terminal colors (src/lib/terminal-theme.ts). */
export const terminalAppearanceLabels = {
  "code-theme": "Code theme",
  ghostty: "Ghostty config",
} satisfies Record<TerminalAppearance, string>;

/** Session actions menu labels (src/lib/session-menu-items.ts), copied from claude.ai/code. */
export const sessionMenuItemLabels = {
  "open-in": "Open in",
  "open-live-terminal": "Live terminal",
  "open-terminal": "Terminal",
  "open-vscode": "VS Code",
  "open-finder": "Finder",
  "open-claude-ai": "claude.ai",
  "open-pr": "Open PR",
  "move-up": "Move up",
  "move-down": "Move down",
  pin: "Pin",
  unpin: "Unpin",
  "mark-read": "Mark as read",
  "mark-unread": "Mark as unread",
  "mark-completed": "Mark as completed",
  rename: "Rename",
  "copy-link": "Copy link",
  fork: "Fork",
  "move-to-group": "Move to group",
  "move-to-custom-group": "Custom group",
  ungroup: "Ungrouped",
  "new-group": "New group…",
  "transcript-view": "Transcript view",
  "transcript-mode": "Transcript mode",
  "make-default-transcript-mode": "Make default",
  archive: "Archive",
  unarchive: "Unarchive",
} satisfies Record<z.infer<typeof SessionMenuItemIdSchema>, string>;

/** Sidebar sections toggleable in the Edit sidebar dialog, in nav order. */
const navSectionLabels = {
  artifacts: "Artifacts",
  routines: "Routines",
  active: "Active",
  herdr: "Herdr",
  tmux: "Tmux Windows",
  approvals: "Approvals",
  notifications: "Notifications",
  tasks: "Tasks",
  projects: "Projects",
  plans: "Plans",
  memories: "Memories",
  customize: "Customize",
} satisfies Record<NavSection, string>;

/** Where a Routines page row runs (src/lib/routines.ts). */
export const routineKindLabels = {
  cron: "Scheduled prompt",
  wakeup: "Wakeup",
  cloud: "Cloud",
} satisfies Record<RoutineKind, string>;

const routineStatusLabels = {
  active: "Active",
  completed: "Completed",
} satisfies Record<RoutineStatus, string>;

/** Routines page Filter ▸ Schedule, as upstream. */
export const routineScheduleFilterLabels = {
  all: "All",
  recurring: "Recurring",
  "one-time": "One-time",
} satisfies Record<RoutineScheduleFilter, string>;

/** Routines page Filter ▸ Status (local routines are only active or completed). */
export const routineStatusFilterLabels = {
  all: "All",
  active: "Active",
  completed: "Completed",
} satisfies Record<RoutineStatusFilter, string>;

export const routineSortLabels = {
  "next-run": "Next run",
  name: "Name",
} satisfies Record<RoutineSort, string>;

/** Page kinds recorded in the per-tab ⌃Q recents history (src/lib/recents-history.ts). */
const recentKindLabels = {
  session: "Session",
  subagents: "Subagents",
  plan: "Plan",
  memory: "Memory",
  project: "Project",
  command: "Command",
} satisfies Record<RecentKind, string>;

/** Per-session transcript views (src/lib/transcript-mode.ts), cycled by ⌃O. */
export const transcriptModeLabels = {
  normal: "Normal",
  thinking: "Thinking",
  verbose: "Verbose",
} satisfies Record<TranscriptMode, string>;

/** Sidebar row drag release outcomes (src/lib/pinned-sessions.ts). */
const pinDropOutcomeLabels = {
  pin: "Pin",
  reorder: "Reorder",
  unpin: "Unpin",
  cancel: "Cancel",
} satisfies Record<PinDropOutcome, string>;

/** `Artifact` tool `action` (src/lib/artifact-schemas.ts); omitted means publish. */
const artifactActionLabels = {
  publish: "Publish",
  read: "Read",
  list: "List",
  delete: "Delete",
  open: "Open",
  pin: "Pin",
  unpin: "Unpin",
  quickstart: "Quickstart",
  read_db: "Read database",
} satisfies Record<z.infer<typeof ArtifactActionSchema>, string>;

const artifactIntentLabels = {
  document: "Document",
  slides: "Slides",
  design: "Design",
  other: "Other",
} satisfies Record<z.infer<typeof ArtifactIntentSchema>, string>;

const artifactListScopeLabels = {
  mine: "Mine",
  shared: "Shared",
  all: "All",
  types: "Types",
  files: "Files",
  assets: "Assets",
} satisfies Record<z.infer<typeof ArtifactListScopeSchema>, string>;

const artifactAutoOpenLabels = {
  at_create: "At create",
  after_first_write: "After first write",
} satisfies Record<z.infer<typeof ArtifactAutoOpenSchema>, string>;

const artifactDbOpLabels = {
  get: "Get",
  list: "List",
} satisfies Record<z.infer<typeof ArtifactDbOpSchema>, string>;

const artifactLiveSubscriptionLabels = {
  arming: "Arming",
  connected: "Connected",
  publish_context: "Publish context",
  flag_off: "Flag off",
} satisfies Record<z.infer<typeof ArtifactLiveSubscriptionSchema>, string>;

/** `ReportFindings` finding `verdict` (src/lib/tool-input-schemas.ts); labels match upstream. */
export const reportFindingsVerdictLabels = {
  CONFIRMED: "Confirmed",
  PLAUSIBLE: "Plausible",
} satisfies Record<z.infer<typeof ReportFindingsVerdictSchema>, string>;

/** `RemoteTrigger` `action` (src/lib/tool-input-schemas.ts); row verbs match upstream's routine verbs. */
export const remoteTriggerActionLabels = {
  list: "Listed routines",
  get: "Read routine",
  create: "Created routine",
  update: "Updated routine",
  run: "Ran routine",
} satisfies Record<z.infer<typeof RemoteTriggerActionSchema>, string>;

/** Failed-row verbs for each `RemoteTrigger` `action`. */
export const remoteTriggerActionFailedLabels = {
  list: "Failed to list routines",
  get: "Failed to read routine",
  create: "Failed to create routine",
  update: "Failed to update routine",
  run: "Failed to run routine",
} satisfies Record<z.infer<typeof RemoteTriggerActionSchema>, string>;

/** `ExitWorktree` `action` (src/lib/tool-input-schemas.ts); the failed-row verb per action. */
export const exitWorktreeActionFailedLabels = {
  keep: "Failed to leave the worktree",
  remove: "Failed to remove the worktree",
} satisfies Record<z.infer<typeof ExitWorktreeActionSchema>, string>;

const toolNamesWithMcp = { ...toolNames, "mcp__*": true } as const;

/** Maps walker path keys (see tests/schema-choices.test.ts) to choice maps. */
export const schemaChoiceRegistry: Record<string, Record<string, string | true>> = {
  TaskStatusSchema: taskStatusLabels,
  UnifiedSearchTypeSchema: unifiedSearchTypeLabels,
  UnifiedSearchDateSchema: unifiedSearchDateLabels,
  UnifiedSearchKindSchema: unifiedSearchKindLabels,
  PaletteTypeSchema: paletteTypeLabels,
  PaletteFilterSchema: paletteFilterLabels,
  SessionSummaryStateSchema: sessionSummaryStateLabels,
  SessionBucketSchema: sessionBucketLabels,
  SessionBucketReasonSchema: sessionBucketReasonLabels,
  SessionStateKindSchema: sessionStateKindLabels,
  HomeAttentionKindSchema: homeAttentionKindLabels,
  "SessionListPrefsSchema.groupBy": sessionGroupByLabels,
  "SessionListPrefsSchema.sortBy": sessionSortByLabels,
  "SessionListPrefsSchema.statusFilter": sessionStatusFilterLabels,
  "SessionListPrefsSchema.activityDays": sessionActivityDaysLabels,
  ContentBlockSchema: contentBlockVariants,
  AttachmentPayloadSchema: attachmentVariants,
  "UserRecordSchema.promptSource": promptSourceLabels,
  JsonlRecordSchema: jsonlRecordVariants,
  "FileEditToolUseResultSchema|0.type": writeToolUseResultTypeLabels,
  "GitOperationSchema.commit.kind": gitCommitKindLabels,
  "GitOperationSchema.branch.action": gitBranchActionLabels,
  "GitOperationSchema.pr.action": gitPrActionLabels,
  RenderedLineSchema: renderedLineVariants,
  "RenderedLineSchema.<assistant|user>.type": messageLineTypeLabels,
  "RenderedLineSchema.<system>.subtype": systemSubtypeLabels,
  "JsonlRecordSchema.<system>.compactMetadata.trigger": compactTriggerLabels,
  "ClaudeSettingsSchema.hooks{}[].hooks[]": claudeHookVariants,
  "ClaudeSettingsSchema.hooks{}[].hooks[].<command>.shell": claudeHookShellLabels,
  "ClaudeSettingsSchema.skillOverrides{}": skillOverrideLabels,
  ToolUseUnion: toolNames,
  HookEventEnvelope: hookEventNames,
  "HookEventEnvelope.<SessionStart>.source": sessionStartSourceLabels,
  "HookEventEnvelope.<UserPromptSubmit>.source": userPromptSourceLabels,
  "HookEventEnvelope.<PreCompact>.trigger": compactTriggerLabels,
  "HookEventEnvelope.<PostCompact>.reason": compactTriggerLabels,
  "HookEventEnvelope.<InstructionsLoaded>.load_reason": instructionsLoadReasonLabels,
  "HookEventEnvelope.<ConfigChange>.config_source": configChangeSourceLabels,
  "HookEventEnvelope.<PreToolUse>": toolNamesWithMcp,
  "HookEventEnvelope.<PostToolUse>": toolNamesWithMcp,
  "HookEventEnvelope.<PostToolUseFailure>": toolNamesWithMcp,
  "SourceFileResponse.language": sourceLanguageLabels,
  "PluginFileSchema.type": pluginFileTypeLabels,
  "PluginListResponse[].versionKind": pluginVersionKindLabels,
  "SkillListResponse[].source": skillSourceLabels,
  "McpServerListResponse[].scope": mcpScopeLabels,
  "McpServerDetailResponse.tools[].behavior": permissionBehaviorLabels,
  "PaneLayoutStateSchema.expanded": paneKindLabels,
  "PaneLayoutStateSchema.root.children[]": paneLayoutNodeVariants,
  "PaneLayoutStateSchema.root.children[].<tile>.tileId": tileIdLabels,
  "PaneLayoutStateSchema.root.direction": paneStackDirectionLabels,
  SettingsTabSchema: settingsTabLabels,
  CodeThemeLightSchema: codeThemeLightLabels,
  CodeThemeDarkSchema: codeThemeDarkLabels,
  TerminalAppearanceSchema: terminalAppearanceLabels,
  NavSectionSchema: navSectionLabels,
  RoutineKindSchema: routineKindLabels,
  RoutineStatusSchema: routineStatusLabels,
  RoutineScheduleFilterSchema: routineScheduleFilterLabels,
  RoutineStatusFilterSchema: routineStatusFilterLabels,
  RoutineSortSchema: routineSortLabels,
  SessionMenuItemIdSchema: sessionMenuItemLabels,
  ChangedFileKindSchema: changedFileKindLabels,
  "RecentsHistorySchema[].kind": recentKindLabels,
  TranscriptModeSchema: transcriptModeLabels,
  GroupIconSchema: groupIconLabels,
  GroupColorSchema: groupColorLabels,
  PinDropOutcomeSchema: pinDropOutcomeLabels,
  ArtifactActionSchema: artifactActionLabels,
  ArtifactIntentSchema: artifactIntentLabels,
  ArtifactListScopeSchema: artifactListScopeLabels,
  ArtifactAutoOpenSchema: artifactAutoOpenLabels,
  ArtifactDbOpSchema: artifactDbOpLabels,
  ArtifactLiveSubscriptionSchema: artifactLiveSubscriptionLabels,
  ReportFindingsVerdictSchema: reportFindingsVerdictLabels,
  RemoteTriggerActionSchema: remoteTriggerActionLabels,
  ExitWorktreeActionSchema: exitWorktreeActionFailedLabels,
};
