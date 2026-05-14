import {z} from 'zod';

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
	SESSION_START: 'session:start',
	SESSION_END: 'session:end',
	WORKTREE_CREATED: 'worktree:created',
	STATUSLINE_UPDATED: 'statusline:updated',
	CONTENT_UPDATED: 'content:updated',
} as const;

/**
 * Domain-level delta events. Payloads carry the data needed to patch the
 * TanStack Query cache client-side without a refetch. The server is
 * responsible for diffing old vs new state and emitting these events.
 */
export const DOMAIN_EVENTS = {
	SESSION_ADDED: 'session:added',
	SESSION_REMOVED: 'session:removed',
	SESSION_UPDATED: 'session:updated',
	SESSION_STARTED: 'session:started',
	SESSION_ENDED: 'session:ended',
	SESSION_LINES_APPENDED: 'session:lines-appended',
	PLAN_CHANGED: 'plan:changed',
	PLAN_REMOVED: 'plan:removed',
	MEMORY_CHANGED: 'memory:changed',
	MEMORY_REMOVED: 'memory:removed',
	TASK_CHANGED: 'task:changed',
	TASK_COMPLETED: 'task:completed',
	APPROVAL_CHANGED: 'approval:changed',
	APPROVAL_RESOLVED: 'approval:resolved',
} as const;

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
	toolName: 'ExitPlanMode' | 'AskUserQuestion';
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

export type JsonValue = string | number | boolean | null | JsonValue[] | {[key: string]: JsonValue};

export interface SessionLinesAppendedPayload {
	sessionId: string;
	lines: Record<string, JsonValue>[];
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
): {added: T[]; removed: string[]; updated: T[]} {
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

	return {added, removed, updated};
}

// ---------------------------------------------------------------------------
// Claude Hook Event Schemas (received from hooks via POST /api/hook)
// ---------------------------------------------------------------------------

const BaseHookFields = z.object({
	session_id: z.string(),
	cwd: z.string().optional(),
	hook_event_name: z.string(),
});

const SessionStartHookEvent = BaseHookFields.extend({
	hook_event_name: z.literal('SessionStart'),
	source: z.string().optional(),
	model: z.string().optional(),
	// Snapshot of all CLAUDE-prefixed environment variables at session start
	// (CLAUDE_CODE_ENTRYPOINT, CLAUDE_CODE_EXECPATH, CLAUDECODE, CLAUDE_EFFORT,
	// CLAUDE_CODE_TASK_LIST_ID, etc.). Captured by the SessionStart hook's jq
	// filter and persisted on the active-session entry for later inspection.
	claude_env: z.record(z.string(), z.string()).optional(),
});

const SessionEndHookEvent = BaseHookFields.extend({
	hook_event_name: z.literal('SessionEnd'),
});

const StopHookEvent = BaseHookFields.extend({
	hook_event_name: z.literal('Stop'),
});

const PostToolUseHookEvent = BaseHookFields.extend({
	hook_event_name: z.literal('PostToolUse'),
	tool_name: z.string(),
	tool_input: z.record(z.string(), z.unknown()).optional(),
	tool_response: z.record(z.string(), z.unknown()).optional(),
});

const TaskCompletedHookEvent = BaseHookFields.extend({
	hook_event_name: z.literal('TaskCompleted'),
	task_id: z.string().optional(),
	task_subject: z.string().optional(),
	task_description: z.string().optional(),
});

const WorktreeCreateHookEvent = BaseHookFields.extend({
	hook_event_name: z.literal('WorktreeCreate'),
	name: z.string().optional(),
});

export const HookEventEnvelope = z.discriminatedUnion('hook_event_name', [
	SessionStartHookEvent,
	SessionEndHookEvent,
	StopHookEvent,
	PostToolUseHookEvent,
	TaskCompletedHookEvent,
	WorktreeCreateHookEvent,
]);

export type HookEvent = z.infer<typeof HookEventEnvelope>;
