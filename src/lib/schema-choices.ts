import type {z} from "zod";
import type {
	ArtifactAccessLevelSchema,
	ArtifactActionSchema,
	ArtifactAutoOpenSchema,
	ArtifactDbOpSchema,
	ArtifactIntentSchema,
	ArtifactListScopeSchema,
	ArtifactLiveSubscriptionSchema,
	ArtifactUserScopeSchema,
} from "./artifact-schemas";
import type {ChangedFileKindSchema} from "./changed-file-kind";
import type {CodeThemeDark, CodeThemeLight} from "./code-themes";
import type {ContextAttachmentKindSchema} from "./context-attach";
import type {PendingApprovalToolNameSchema} from "./domain-event-payload-schemas";
import type {TerminalAppearance} from "./terminal-theme";
import type {TerminalHostSetting} from "./terminal-host-setting";
import type {McpScopeSchema, PermissionBehaviorSchema, SkillSourceSchema} from "./api/customize";
import type {PluginFileSchema, PluginListResponse} from "./api/plugins";
import type {UnifiedSearchDateSchema, UnifiedSearchKindSchema, UnifiedSearchTypeSchema} from "./api/search";
import type {SessionSummaryStateSchema} from "./api/sessions";
import type {SourceFileResponse} from "./api/source";
import type {GroupColorSchema, GroupIconSchema} from "./group-appearance";
import type {EffortLevel, LaunchPermissionMode, LiveOptionChange} from "./launch-options";
import type {HookEvent, PermissionUpdate, ToolUseUnion} from "./hook-events";
import {PERSISTENT_ALLOW_KIND_BY_DESTINATION} from "./permission-suggestions";
import type {JobChildKindSchema, JobFanKindSchema, JobNameSourceSchema, JobState, JobTempoSchema} from "./jobs";
import type {NavSection} from "./nav-sections";
import type {PinDropOutcome} from "./pinned-sessions";
import type {PaletteFilter, PaletteType} from "./palette-tokens";
import type {Direction, LayoutNode, PaneKind, TileId} from "./pane-layout";
import type {
	ApiRequestBlobContentBlockSchema,
	ApiRequestBlobRoleSchema,
	AttachmentPayloadSchema,
	ClaudeSettingsSchema,
	ContentBlockSchema,
	ContextUsageCategoryKindSchema,
	ContextUsageOverLimitKindSchema,
	GitBranchActionSchema,
	GitCommitKindSchema,
	GitPrActionSchema,
	JsonlRecordSchema,
	PermissionDecisionCircuitBreakerSchema,
	PermissionDecisionClassifierCategorySchema,
	PermissionDecisionDecisionSchema,
	PermissionDecisionGrantScopeSchema,
	PermissionDecisionReasonTypeSchema,
	PermissionDecisionRuleSourceSchema,
	PermissionDecisionSourceSchema,
	PluginCatalogSourceKindSchema,
	RenderedRoleSchema,
	SessionRegistryStatusSchema,
	SkillOverrideValueSchema,
	TaskStatusSchema,
	ThinkingDisplaySchema,
	ToolAdditionToolSchema,
	TurnOriginSchema,
	UserRecordSchema,
	WriteToolUseResultTypeSchema,
} from "./schemas";
import type {
	SessionActivityDaysSchema,
	SessionGroupBySchema,
	SessionSortBySchema,
	SessionSortDirectionSchema,
	SessionStatusFilterSchema,
} from "./session-groups";
import type {GhCheckRunConclusionSchema, GhStatusContextStateSchema} from "./pr-details";
import type {GhPrReviewDecisionSchema, GhPrStateSchema, GhPrStatusCacheStateSchema} from "./pr-status";
import type {
	PullRequestStateSchema,
	SessionBucketReasonSchema,
	SessionBucketSchema,
	SessionStateKindSchema,
} from "./session-state";
import type {SessionMenuItemIdSchema} from "./session-menu-items";
import type {CustomizeDetailTab, CustomizeSection, CustomizeView, SettingsTab} from "./settings-hash";
import type {MessageProcessedLine, ProcessedLine} from "./transcript";
import type {RecentKind} from "./recents-history";
import type {RoutineKind, RoutineScheduleFilter, RoutineSort, RoutineStatus, RoutineStatusFilter} from "./routines";
import type {TranscriptMode} from "./transcript-mode";
import type {
	ExitWorktreeActionSchema,
	RemoteTriggerActionSchema,
	ReportFindingsVerdictSchema,
	SendMessageRecipientKindSchema,
	StringifiedBooleanSchema,
	WebSearchModeSchema,
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
type ClaudeHook = NonNullable<z.infer<typeof ClaudeSettingsSchema>["hooks"]>[string][number]["hooks"][number];
type ClaudeCommandHook = Extract<ClaudeHook, {type: "command"}>;
type HookEventOf<Name extends HookEvent["hook_event_name"]> = Extract<HookEvent, {hook_event_name: Name}>;

export const promptSourceLabels = {
	typed: "Typed",
	system: "System",
	sdk: "SDK",
	queued: "Queued",
	suggestion_accepted: "Suggestion accepted",
} satisfies Record<PromptSource, string>;

export const turnOriginLabels = {
	human: "Human",
	peer: "From another session",
	task_notification: "Task notification",
	scheduled: "Scheduled task",
	system: "System notice",
	sdk: "From the SDK",
} satisfies Record<z.infer<typeof TurnOriginSchema>, string>;

export const permissionDecisionDecisionLabels = {
	accept: "Accepted",
	reject: "Rejected",
} satisfies Record<z.infer<typeof PermissionDecisionDecisionSchema>, string>;

export const permissionDecisionSourceLabels = {
	config: "Configuration",
	hook: "Hook",
	user_abort: "User (aborted)",
	user_permanent: "User (always)",
	user_reject: "User (rejected)",
	user_temporary: "User (once)",
} satisfies Record<z.infer<typeof PermissionDecisionSourceSchema>, string>;

export const permissionDecisionReasonTypeLabels = {
	asyncAgent: "No approval prompt",
	classifier: "Classifier",
	hook: "Hook",
	mode: "Permission mode",
	other: "Other",
	rule: "Permission rule",
	safetyCheck: "Safety check",
	sandboxOverride: "Sandbox override",
	subcommandResults: "Subcommand results",
	workingDir: "Working directories",
} satisfies Record<z.infer<typeof PermissionDecisionReasonTypeSchema>, string>;

const permissionDecisionRuleSourceLabels = {
	userSettings: "User settings",
	projectSettings: "Project settings",
	localSettings: "Local settings",
	flagSettings: "Flag settings",
	policySettings: "Managed policy",
	cliArg: "CLI argument",
	command: "Command",
	session: "Session",
	toolsNarrowing: "Tool narrowing",
	mcpServerPolicy: "MCP server policy",
	hostCredential: "Host credential",
} satisfies Record<z.infer<typeof PermissionDecisionRuleSourceSchema>, string>;

const permissionDecisionGrantScopeLabels = {
	once: "This call only",
	session: "Rest of session",
} satisfies Record<z.infer<typeof PermissionDecisionGrantScopeSchema>, string>;

const permissionDecisionCircuitBreakerLabels = {
	dangerousRemoval: "Dangerous removal",
	backgroundOperator: "Background operator",
	suspiciousWindowsPath: "Suspicious Windows path",
	isolatePeerMachines: "Isolated peer machines",
	restrictedMode: "Restricted mode",
	outsideReadsBlocked: "Reads outside working directories blocked",
	claudeSettingsFile: "Claude settings file",
	internalHardDeny: "Internal hard deny",
	unfinishedCheck: "Unfinished check",
} satisfies Record<z.infer<typeof PermissionDecisionCircuitBreakerSchema>, string>;

const permissionDecisionClassifierCategories = {
	account_standing_rule_changes: true,
	auto_mode_bypass: true,
	blind_apply: true,
	browser_file_upload_exfil: true,
	browser_input_exfil: true,
	browser_js_exfil: true,
	browser_navigate_exfil: true,
	browser_shortcut_execution: true,
	chatops_trigger_comments: true,
	ci_bypass: true,
	cloud_storage_mass_delete: true,
	cluster_wide_workload_creation: true,
	code_from_external: true,
	code_that_leaks_when_run: true,
	command_network_lists: true,
	containment_escape: true,
	create_public_surface: true,
	create_rce_surface: true,
	create_unsafe_agents: true,
	credential_exploration: true,
	credential_leakage: true,
	credential_materialization: true,
	data_exfiltration: true,
	dns_domain_cert_changes: true,
	excess_sensitive_detail: true,
	exfil_scouting: true,
	expose_local_services: true,
	external_ingress_tunnel: true,
	external_system_writes: true,
	feature_flag_writes: true,
	git_destructive: true,
	instruction_poisoning: true,
	interfere_with_workloads: true,
	irreversible_deletion_general: true,
	irreversible_local_destruction: true,
	live_shared_artifact_sensitive_delta: true,
	logging_audit_tampering: true,
	merge_without_review: true,
	modify_shared_resources: true,
	node_lifecycle_operations: true,
	out_of_place_publication: true,
	package_registry_bypass: true,
	permission_grant: true,
	pii_data_handling: true,
	production_deploy: true,
	production_reads: true,
	protected_scope_iac_apply: true,
	public_data_sharing_upload: true,
	real_world_transactions: true,
	remote_repoint: true,
	remote_shell_writes: true,
	safety_bypass_flag: true,
	sandbox_network_callback: true,
	secret_store_writes: true,
	security_test_removal: true,
	security_weaken: true,
	self_approval: true,
	self_modification: true,
	sensitive_remote_exec: true,
	sensitive_source_provenance: true,
	session_transcript_tampering: true,
	shared_cluster_mutation: true,
	shared_scratch_sweep: true,
	third_party_attack: true,
	tls_auth_weaken: true,
	tmux_self_drive: true,
	traffic_redirection: true,
	unauthorized_persistence: true,
	unrequested_artifact_publish: true,
	unrequested_commit_in_a_connected_app: true,
	untrusted_code_integration: true,
	unverifiable_deletion_scope: true,
	unverifiable_deletion_target: true,
	cowork_delete_grant: true,
	cowork_folder_access: true,
	cowork_run_routine_now: true,
	cowork_scheduled_task_delete: true,
	cowork_scheduled_task_write: true,
	cowork_skill_persistence: true,
} satisfies Record<z.infer<typeof PermissionDecisionClassifierCategorySchema>, true>;

const taskStatusLabels = {
	pending: "Pending",
	in_progress: "In progress",
	completed: "Completed",
} satisfies Record<z.infer<typeof TaskStatusSchema>, string>;

/** `status` in the CLI's live session registry, `~/.claude/sessions/<pid>.json`. */
const sessionRegistryStatusLabels = {
	idle: "Idle",
	busy: "Working",
	waiting: "Needs input",
	shell: "Running a shell command",
} satisfies Record<z.infer<typeof SessionRegistryStatusSchema>, string>;

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

/** Filter & group menu options (src/lib/session-groups.ts); local "Project" is upstream "Folder". */
export const sessionGroupByLabels = {
	date: "Date",
	project: "Folder",
	state: "Status",
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
	activity: "Last updated",
} satisfies Record<z.infer<typeof SessionSortBySchema>, string>;

export const sessionSortDirectionLabels = {
	desc: "Descending",
	asc: "Ascending",
} satisfies Record<z.infer<typeof SessionSortDirectionSchema>, string>;

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

/** Normalized session PR states (src/lib/pr-status.ts); upstream glyph label suffixes. */
const pullRequestStateLabels = {
	open: "Open",
	draft: "Draft",
	merged: "Merged",
	closed: "Closed",
} satisfies Record<z.infer<typeof PullRequestStateSchema>, string>;

/** Not consumed yet — `thinkingDisplay` on assistant JSONL records is only validated. */
const thinkingDisplayChoices = {
	updates: true,
	omitted: true,
} satisfies Record<z.infer<typeof ThinkingDisplaySchema>, true>;

/** Not consumed yet — `/context` twin category kinds on `system/local_command` records. */
const contextUsageCategoryKindChoices = {
	used: true,
	free: true,
	buffer: true,
	deferred: true,
} satisfies Record<z.infer<typeof ContextUsageCategoryKindSchema>, true>;

/** Not consumed yet — `/context` twin `over_limit.kind` on `system/local_command` records. */
const contextUsageOverLimitKindChoices = {
	hard_limit: true,
	compaction_window: true,
} satisfies Record<z.infer<typeof ContextUsageOverLimitKindSchema>, true>;

/** `renderedRole` on attachment JSONL records. */
const renderedRoleChoices = {
	system: true,
	user: true,
} satisfies Record<z.infer<typeof RenderedRoleSchema>, true>;

/** `gh pr list|view --json state` values. */
const ghPrStateChoices = {
	OPEN: true,
	CLOSED: true,
	MERGED: true,
} satisfies Record<z.infer<typeof GhPrStateSchema>, true>;

/** `state` in ~/.claude/gh-pr-status-cache.json. */
const ghPrStatusCacheStateChoices = {
	OPEN: true,
	DRAFT: true,
	MERGED: true,
	CLOSED: true,
} satisfies Record<z.infer<typeof GhPrStatusCacheStateSchema>, true>;

/** `review` in ~/.claude/gh-pr-status-cache.json. */
const ghPrReviewDecisionChoices = {
	APPROVED: true,
	CHANGES_REQUESTED: true,
	REVIEW_REQUIRED: true,
} satisfies Record<z.infer<typeof GhPrReviewDecisionSchema>, true>;

/** `conclusion` of a CheckRun in the `gh api graphql` PR details reply. */
const ghCheckRunConclusionChoices = {
	ACTION_REQUIRED: true,
	CANCELLED: true,
	FAILURE: true,
	NEUTRAL: true,
	SKIPPED: true,
	STALE: true,
	STARTUP_FAILURE: true,
	SUCCESS: true,
	TIMED_OUT: true,
} satisfies Record<z.infer<typeof GhCheckRunConclusionSchema>, true>;

/** `state` of a StatusContext in the `gh api graphql` PR details reply. */
const ghStatusContextStateChoices = {
	ERROR: true,
	EXPECTED: true,
	FAILURE: true,
	PENDING: true,
	SUCCESS: true,
} satisfies Record<z.infer<typeof GhStatusContextStateSchema>, true>;

export const unifiedSearchTypeLabels = {
	all: "All",
	sessions: "Sessions",
	plans: "Plans",
	memories: "Memories",
	files: "Files",
} satisfies Record<z.infer<typeof UnifiedSearchTypeSchema>, string>;

export const unifiedSearchDateLabels = {
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
	artifacts: "Artifacts",
	// Upstream's code-context label for its code-session tab
	sessions: "Code",
	projects: "Projects",
	scheduled: "Scheduled",
	plans: "Plans",
	memories: "Memories",
	files: "Files",
} satisfies Record<PaletteType, string>;

export const paletteFilterLabels = {
	project: "Project",
	date: "Date",
	repo: "Repo",
	type: "Type",
	archived: "Archived",
	actions: "Actions",
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

const modelSwitchSourceLabels = {
	command: "Command",
	picker: "Model picker",
	sdk: "SDK",
	auto: "Automatic",
	resume: "Resume",
} satisfies Record<HookEventOf<"PostModelSwitch">["source"], string>;

const promptCacheTtlLabels = {
	"5m": "5 minutes",
	"1h": "1 hour",
} satisfies Record<HookEventOf<"PostModelSwitch">["cache_ttl"], string>;

const modelSwitchPricingLabels = {
	configured: "Configured rates",
	catalog: "List price",
	default: "Default rate",
} satisfies Record<HookEventOf<"PostModelSwitch">["pricing"], string>;

const elicitationModeLabels = {
	form: "Form",
	url: "URL",
} satisfies Record<NonNullable<HookEventOf<"Elicitation">["mode"]>, string>;

const elicitationActionLabels = {
	accept: "Accepted",
	decline: "Declined",
	cancel: "Cancelled",
} satisfies Record<HookEventOf<"ElicitationResult">["action"], string>;

/** How the viewer presents a `Notification` hook's `notification_type`. */
export type NotificationTypePresentation = "permission" | "elicitation" | "needs_input" | "completed" | "info";

/**
 * Known `Notification.notification_type` values. The hook schema keeps the
 * field freeform (an unknown value must not drop the event), so the known kinds
 * are classified here instead. The CLI 2.1.307 list is copied in its own order,
 * followed by the types the viewer persists itself (src/lib/hook-dispatcher.ts).
 * The CLI raises `elicitation_dialog` / `elicitation_url_dialog` while an MCP
 * elicitation dialog waits on the user.
 */
export const notificationTypePresentations = {
	permission_prompt: "permission",
	idle_prompt: "needs_input",
	auth_success: "info",
	elicitation_dialog: "elicitation",
	agent_needs_input: "needs_input",
	agent_completed: "completed",
	elicitation_url_dialog: "elicitation",
	worker_permission_prompt: "permission",
	push_notification: "info",
	computer_use_enter: "info",
	computer_use_exit: "info",
	quota_auto_resume_fired: "info",
	quota_auto_resume_stale: "info",
	quota_auto_resume_disabled: "info",
	model_refusal_fallback: "info",
	auth_storage_failure: "info",
	plugin_notification: "info",
	mcp_elicitation: "elicitation",
	turn_failed: "info",
} as const satisfies Record<string, NotificationTypePresentation>;

const notificationTypePresentationsByType: ReadonlyMap<string, NotificationTypePresentation> = new Map(
	Object.entries(notificationTypePresentations),
);

/** The presentation for a `notification_type`; unknown and future types read as info. */
export function notificationTypePresentation(notificationType: string): NotificationTypePresentation {
	return notificationTypePresentationsByType.get(notificationType) ?? "info";
}

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
	scheduled_task_fire: "Scheduled task fire",
	local_command: "Local command",
	bridge_status: "Remote Control status",
} satisfies Record<Extract<ProcessedLine, {type: "system"}>["subtype"], string>;

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
	skill_mention: true,
	inlined_image_paths: true,
	session_cron_carry: true,
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
	"dev-mods": true,
	"api-request": true,
	"api-request-blob": true,
	"api-request-shape": true,
} satisfies Record<z.infer<typeof JsonlRecordSchema>["type"], true>;

/** Not consumed yet — the API request log is only validated. */
const apiRequestBlobContentBlockVariants = {
	text: true,
	thinking: true,
	tool_use: true,
	tool_result: true,
	image: true,
	tool_addition: true,
} satisfies Record<z.infer<typeof ApiRequestBlobContentBlockSchema>["type"], true>;

/** Not consumed yet — the API request log is only validated. */
const toolAdditionToolVariants = {
	tool_definition: true,
	tool_reference: true,
} satisfies Record<z.infer<typeof ToolAdditionToolSchema>["type"], true>;

const apiRequestBlobRoleLabels = {
	user: "User",
	assistant: "Assistant",
	system: "System",
} satisfies Record<z.infer<typeof ApiRequestBlobRoleSchema>, string>;

/** Exhaustive handler: renderSessionMessage switch in src/components/session-chat.tsx. */
const renderedLineVariants = {
	user: true,
	assistant: true,
	"agent-name": true,
	"agent-color": true,
	"permission-mode": true,
	"artifact-link": true,
	"artifact-watch": true,
	"queued-task-notification": true,
	"queued-prompt": true,
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
	PermissionRequest: true,
	TaskCreated: true,
	TaskCompleted: true,
	WorktreeCreate: true,
	WorktreeRemove: true,
	CwdChanged: true,
	InstructionsLoaded: true,
	ConfigChange: true,
	MessageDisplay: true,
	StopFailure: true,
	PermissionDenied: true,
	PostModelSwitch: true,
	Elicitation: true,
	ElicitationResult: true,
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
	SubagentHandback: true,
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
	"side-chat": "Side chat",
	"session-details": "Session details",
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

/** Customize sections in the Settings dialog nav, after Claude Code, as on claude.ai/code. */
export const customizeSectionLabels = {
	skills: "Skills",
	connectors: "Connectors",
	plugins: "Plugins",
} satisfies Record<CustomizeSection, string>;

const customizeViewLabels = {
	yours: "Yours",
	discover: "Discover",
} satisfies Record<CustomizeView, string>;

const customizeDetailTabLabels = {
	contents: "Contents",
	skills: "Skills",
	connectors: "Connectors",
	agents: "Agents",
	commands: "Commands",
	hooks: "Hooks",
} satisfies Record<CustomizeDetailTab, string>;

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

/** Terminal host picker in Settings › Application (src/lib/terminal-host-setting.ts). */
export const terminalHostSettingLabels = {
	auto: "Auto",
	herdr: "herdr",
	tmux: "tmux",
} satisfies Record<TerminalHostSetting, string>;

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
	jobs: "Background jobs",
	active: "Active",
	herdr: "Herdr",
	approvals: "Approvals",
	notifications: "Notifications",
	tasks: "Tasks",
	projects: "Projects",
	plans: "Plans",
	memories: "Memories",
	sessions: "Sessions",
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

/** Background job state pill (`~/.claude/jobs/<short>/state.json`, src/lib/jobs.ts). */
export const jobStateLabels = {
	working: "Working",
	running: "Running",
	blocked: "Blocked",
	done: "Done",
	failed: "Failed",
} satisfies Record<JobState, string>;

const jobTempoLabels = {
	idle: "Idle",
	blocked: "Blocked",
} satisfies Record<z.infer<typeof JobTempoSchema>, string>;

const jobNameSourceLabels = {
	auto: "Automatic",
	user: "User",
} satisfies Record<z.infer<typeof JobNameSourceSchema>, string>;

/** What a background job produced: a published artifact frame or a pull request. */
export const jobChildKindLabels = {
	frame: "Artifact",
	pr: "Pull request",
} satisfies Record<z.infer<typeof JobChildKindSchema>, string>;

const jobFanKindLabels = {
	agent: "Agent",
} satisfies Record<z.infer<typeof JobFanKindSchema>, string>;

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

/** Composer mode menu labels (src/lib/launch-options.ts), in upstream wording. */
export const launchPermissionModeLabels = {
	auto: "Auto",
	default: "Manual",
	acceptEdits: "Accept edits",
	plan: "Plan",
	bypassPermissions: "Bypass permissions",
} satisfies Record<LaunchPermissionMode, string>;

/** Composer effort slider stops (src/lib/launch-options.ts). */
export const effortLevelLabels = {
	low: "Low",
	medium: "Medium",
	high: "High",
	xhigh: "Extra-high",
	max: "Max",
	ultracode: "Ultracode",
} satisfies Record<EffortLevel, string>;

/** The effort slider's tick tooltips, which shorten Extra-high. */
export const effortLevelShortLabels = {
	low: "Low",
	medium: "Medium",
	high: "High",
	xhigh: "Extra",
	max: "Max",
	ultracode: "Ultracode",
} satisfies Record<EffortLevel, string>;

/** Chin picks applied to a live herdr pane (src/lib/herdr/live-option.ts). */
const liveOptionChangeVariants = {
	model: true,
	effort: true,
	mode: true,
} satisfies Record<LiveOptionChange["kind"], true>;

/** Composer context chip kinds attached with ⇧⌘L (src/lib/context-attach.ts). */
const contextAttachmentKindLabels = {
	file: "File",
	selection: "Selection",
	terminal: "Terminal output",
	image: "Image",
	message: "Message",
} satisfies Record<z.infer<typeof ContextAttachmentKindSchema>, string>;

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

/** `Artifact` `capabilities.db.rules[]` read/write minimum (src/lib/artifact-schemas.ts). */
const artifactAccessLevelLabels = {
	view: "View",
	interact: "Interact",
	admin: "Admin",
	owner: "Owner",
} satisfies Record<z.infer<typeof ArtifactAccessLevelSchema>, string>;

/** `Artifact` `capabilities.user.scopes[]` (src/lib/artifact-schemas.ts). */
const artifactUserScopeLabels = {
	profile: "Profile",
	email: "Email",
} satisfies Record<z.infer<typeof ArtifactUserScopeSchema>, string>;

/** WebSearch `mode` (src/lib/tool-input-schemas.ts). */
const webSearchModeLabels = {
	standard: "Standard",
	extended: "Extended",
} satisfies Record<z.infer<typeof WebSearchModeSchema>, string>;

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

/** `ExitWorktree` `action` (src/lib/tool-input-schemas.ts); upstream reads "Left the worktree" for both. */
export const exitWorktreeActionLabels = {
	keep: "Left the worktree",
	remove: "Left the worktree",
} satisfies Record<z.infer<typeof ExitWorktreeActionSchema>, string>;

/** Agent `run_in_background` / Monitor `persistent` sent as strings (src/lib/tool-input-schemas.ts). */
const stringifiedBooleanLabels = {
	true: "Yes",
	false: "No",
} satisfies Record<z.infer<typeof StringifiedBooleanSchema>, string>;

/** SendMessage `recipient_kind` (src/lib/tool-input-schemas.ts). */
const sendMessageRecipientKindLabels = {
	name: "Name",
	agent: "Agent",
	session: "Session",
} satisfies Record<z.infer<typeof SendMessageRecipientKindSchema>, string>;

/** `marketplace_entry.source.source` in plugin-catalog-cache.json (src/lib/customize/discover.ts). */
const pluginCatalogSourceKindLabels = {
	url: "Git repository",
	"git-subdir": "Git subdirectory",
} satisfies Record<z.infer<typeof PluginCatalogSourceKindSchema>, string>;

/** Pending approval `toolName` (src/lib/domain-event-payload-schemas.ts). */
const pendingApprovalToolNameLabels = {
	ExitPlanMode: "Plan approval",
	AskUserQuestion: "Question",
} satisfies Record<z.infer<typeof PendingApprovalToolNameSchema>, string>;

/** Exhaustive handler: offersPersistentOption switch in src/lib/permission-suggestions.ts. */
const permissionUpdateVariants = {
	addRules: true,
	replaceRules: true,
	removeRules: true,
	setMode: true,
	addDirectories: true,
	removeDirectories: true,
} satisfies Record<PermissionUpdate["type"], true>;

const toolNamesWithMcp = {...toolNames, "mcp__*": true} as const;

/** Maps walker path keys (see tests/schema-choices.test.ts) to choice maps. */
export const schemaChoiceRegistry: Record<string, Record<string, string | true>> = {
	TaskStatusSchema: taskStatusLabels,
	"SessionRegistryFileSchema.status": sessionRegistryStatusLabels,
	UnifiedSearchTypeSchema: unifiedSearchTypeLabels,
	UnifiedSearchDateSchema: unifiedSearchDateLabels,
	UnifiedSearchKindSchema: unifiedSearchKindLabels,
	PaletteTypeSchema: paletteTypeLabels,
	PaletteFilterSchema: paletteFilterLabels,
	SessionSummaryStateSchema: sessionSummaryStateLabels,
	SessionBucketSchema: sessionBucketLabels,
	SessionBucketReasonSchema: sessionBucketReasonLabels,
	SessionStateKindSchema: sessionStateKindLabels,
	PullRequestStateSchema: pullRequestStateLabels,
	GhPrStateSchema: ghPrStateChoices,
	GhPrStatusCacheStateSchema: ghPrStatusCacheStateChoices,
	GhPrReviewDecisionSchema: ghPrReviewDecisionChoices,
	GhCheckRunConclusionSchema: ghCheckRunConclusionChoices,
	GhStatusContextStateSchema: ghStatusContextStateChoices,
	"SessionListPrefsSchema.groupBy": sessionGroupByLabels,
	"SessionListPrefsSchema.sortBy": sessionSortByLabels,
	"SessionListPrefsSchema.sortDirection": sessionSortDirectionLabels,
	"SessionListPrefsSchema.statusFilter": sessionStatusFilterLabels,
	"SessionListPrefsSchema.activityDays": sessionActivityDaysLabels,
	ContentBlockSchema: contentBlockVariants,
	AttachmentPayloadSchema: attachmentVariants,
	"UserRecordSchema.promptSource": promptSourceLabels,
	"UserRecordSchema.turnOrigin": turnOriginLabels,
	"UserRecordSchema.permissionDecision.decision": permissionDecisionDecisionLabels,
	"UserRecordSchema.permissionDecision.source": permissionDecisionSourceLabels,
	"UserRecordSchema.permissionDecision.reasonType": permissionDecisionReasonTypeLabels,
	"UserRecordSchema.permissionDecision.ruleSource": permissionDecisionRuleSourceLabels,
	"UserRecordSchema.permissionDecision.grantScope": permissionDecisionGrantScopeLabels,
	"UserRecordSchema.permissionDecision.circuitBreaker": permissionDecisionCircuitBreakerLabels,
	"UserRecordSchema.permissionDecision.classifierCategory": permissionDecisionClassifierCategories,
	JsonlRecordSchema: jsonlRecordVariants,
	"JsonlRecordSchema.<api-request-blob>.message.content|1[]": apiRequestBlobContentBlockVariants,
	"JsonlRecordSchema.<api-request-blob>.message.content|1[].<tool_addition>.tool": toolAdditionToolVariants,
	"JsonlRecordSchema.<api-request-blob>.message.role": apiRequestBlobRoleLabels,
	"FileEditToolUseResultSchema|0.type": writeToolUseResultTypeLabels,
	"GitOperationSchema.commit.kind": gitCommitKindLabels,
	"GitOperationSchema.branch.action": gitBranchActionLabels,
	"GitOperationSchema.pr.action": gitPrActionLabels,
	RenderedLineSchema: renderedLineVariants,
	"RenderedLineSchema.<assistant|user>.type": messageLineTypeLabels,
	"RenderedLineSchema.<system>.subtype": systemSubtypeLabels,
	"JsonlRecordSchema.<system>.compactMetadata.trigger": compactTriggerLabels,
	"JsonlRecordSchema.<attachment>.renderedRole": renderedRoleChoices,
	"JsonlRecordSchema.<assistant>.thinkingDisplay": thinkingDisplayChoices,
	"JsonlRecordSchema.<system>.contextUsage.over_limit.kind": contextUsageOverLimitKindChoices,
	"JsonlRecordSchema.<system>.contextUsage.categories[].kind": contextUsageCategoryKindChoices,
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
	"HookEventEnvelope.<PermissionRequest>": toolNamesWithMcp,
	"HookEventEnvelope.<PermissionDenied>": toolNamesWithMcp,
	"HookEventEnvelope.<PostModelSwitch>.source": modelSwitchSourceLabels,
	"HookEventEnvelope.<PostModelSwitch>.cache_ttl": promptCacheTtlLabels,
	"HookEventEnvelope.<PostModelSwitch>.pricing": modelSwitchPricingLabels,
	"HookEventEnvelope.<Elicitation>.mode": elicitationModeLabels,
	"HookEventEnvelope.<ElicitationResult>.action": elicitationActionLabels,
	"HookEventEnvelope.<PermissionRequest>.<Bash>.permission_suggestions[]": permissionUpdateVariants,
	"HookEventEnvelope.<PermissionRequest>.<Bash>.permission_suggestions[].<addRules>.behavior":
		permissionBehaviorLabels,
	"HookEventEnvelope.<PermissionRequest>.<Bash>.permission_suggestions[].<addRules>.destination":
		PERSISTENT_ALLOW_KIND_BY_DESTINATION,
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
	CustomizeSectionSchema: customizeSectionLabels,
	CustomizeViewSchema: customizeViewLabels,
	CustomizeDetailTabSchema: customizeDetailTabLabels,
	CodeThemeLightSchema: codeThemeLightLabels,
	CodeThemeDarkSchema: codeThemeDarkLabels,
	TerminalAppearanceSchema: terminalAppearanceLabels,
	TerminalHostSettingSchema: terminalHostSettingLabels,
	NavSectionSchema: navSectionLabels,
	RoutineKindSchema: routineKindLabels,
	RoutineStatusSchema: routineStatusLabels,
	RoutineScheduleFilterSchema: routineScheduleFilterLabels,
	RoutineStatusFilterSchema: routineStatusFilterLabels,
	RoutineSortSchema: routineSortLabels,
	JobStateSchema: jobStateLabels,
	JobTempoSchema: jobTempoLabels,
	JobNameSourceSchema: jobNameSourceLabels,
	JobChildKindSchema: jobChildKindLabels,
	JobFanKindSchema: jobFanKindLabels,
	SessionMenuItemIdSchema: sessionMenuItemLabels,
	ChangedFileKindSchema: changedFileKindLabels,
	"RecentsHistorySchema[].kind": recentKindLabels,
	TranscriptModeSchema: transcriptModeLabels,
	LaunchPermissionModeSchema: launchPermissionModeLabels,
	EffortLevelSchema: effortLevelLabels,
	LiveOptionChangeSchema: liveOptionChangeVariants,
	GroupIconSchema: groupIconLabels,
	GroupColorSchema: groupColorLabels,
	PinDropOutcomeSchema: pinDropOutcomeLabels,
	ContextAttachmentKindSchema: contextAttachmentKindLabels,
	PendingApprovalToolNameSchema: pendingApprovalToolNameLabels,
	ArtifactActionSchema: artifactActionLabels,
	ArtifactIntentSchema: artifactIntentLabels,
	ArtifactListScopeSchema: artifactListScopeLabels,
	ArtifactAutoOpenSchema: artifactAutoOpenLabels,
	ArtifactDbOpSchema: artifactDbOpLabels,
	ArtifactLiveSubscriptionSchema: artifactLiveSubscriptionLabels,
	ArtifactAccessLevelSchema: artifactAccessLevelLabels,
	ArtifactUserScopeSchema: artifactUserScopeLabels,
	ReportFindingsVerdictSchema: reportFindingsVerdictLabels,
	RemoteTriggerActionSchema: remoteTriggerActionLabels,
	ExitWorktreeActionSchema: exitWorktreeActionLabels,
	StringifiedBooleanSchema: stringifiedBooleanLabels,
	SendMessageRecipientKindSchema: sendMessageRecipientKindLabels,
	WebSearchModeSchema: webSearchModeLabels,
	PluginCatalogSourceKindSchema: pluginCatalogSourceKindLabels,
};
