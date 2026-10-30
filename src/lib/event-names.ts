// SSE event names, kept apart from the hook event schemas in `hook-events.ts` so client code that only needs the
// names doesn't download those schemas.

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
	SESSION_PENDING_QUESTION_CHANGED: "session:pending-question-changed",
	SESSION_PENDING_PLAN_CHANGED: "session:pending-plan-changed",
	/** A session's pending MCP elicitations changed: one arrived, was answered, or its turn ended. */
	SESSION_ELICITATION_CHANGED: "session:elicitation-changed",
	SESSION_COMPACTING: "session:compacting",
	SESSION_COMPACTED: "session:compacted",
	/** The ccb-context-mirror mod wrote a session's context breakdown. */
	SESSION_CONTEXT_BREAKDOWN_CHANGED: "session:context-breakdown-changed",
	SUBAGENT_STARTED: "subagent:started",
	SUBAGENT_STOPPED: "subagent:stopped",
	SUBAGENTS_SNAPSHOT: "subagents:snapshot",
	/** A session's indexed subagents changed in a way the running-tasks count reads (a teammate's command started or ended). */
	SUBAGENTS_CHANGED: "subagents:changed",
	/** A session's workflow run files changed: a run file, journal, agent meta or agent transcript. */
	WORKFLOWS_CHANGED: "workflows:changed",
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
	JOBS_CHANGED: "jobs:changed",
} as const;
