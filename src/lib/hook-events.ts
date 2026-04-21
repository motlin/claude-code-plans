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

export type SseEventType = (typeof SSE_EVENTS)[keyof typeof SSE_EVENTS];

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
	TASK_CHANGED: 'task:changed',
	TASK_COMPLETED: 'task:completed',
} as const;

export type DomainEventType = (typeof DOMAIN_EVENTS)[keyof typeof DOMAIN_EVENTS];

// ---------------------------------------------------------------------------
// SSE Event Payloads (sent to client)
// ---------------------------------------------------------------------------

/**
 * Summary payload for a single session, matching the serialized shape
 * emitted by `getSessions` / `getStarredSessionList` server functions.
 * Dates are ISO strings so payloads survive JSON serialization to clients.
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
}

/** Summary payload for a single plan, matching `getPlans` output. */
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

export interface SessionLinesAppendedPayload {
	sessionId: string;
	lines: Record<string, unknown>[];
}

export interface DomainEventPayloads {
	[DOMAIN_EVENTS.SESSION_ADDED]: {session: SessionSummaryPayload};
	[DOMAIN_EVENTS.SESSION_REMOVED]: {sessionId: string; projectDir: string};
	[DOMAIN_EVENTS.SESSION_UPDATED]: {session: SessionSummaryPayload};
	[DOMAIN_EVENTS.SESSION_STARTED]: {session: ActiveSessionPayload};
	[DOMAIN_EVENTS.SESSION_ENDED]: {sessionId: string};
	[DOMAIN_EVENTS.SESSION_LINES_APPENDED]: SessionLinesAppendedPayload;
	[DOMAIN_EVENTS.PLAN_CHANGED]: {plan: PlanSummaryPayload};
	[DOMAIN_EVENTS.PLAN_REMOVED]: {filename: string};
	[DOMAIN_EVENTS.MEMORY_CHANGED]: {memory: MemorySummaryPayload};
	[DOMAIN_EVENTS.TASK_CHANGED]: {task: TaskSummaryPayload};
	[DOMAIN_EVENTS.TASK_COMPLETED]: {taskId: string; subject: string};
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

export const SessionStartHookEvent = BaseHookFields.extend({
	hook_event_name: z.literal('SessionStart'),
	source: z.string().optional(),
	model: z.string().optional(),
});

export const SessionEndHookEvent = BaseHookFields.extend({
	hook_event_name: z.literal('SessionEnd'),
});

export const StopHookEvent = BaseHookFields.extend({
	hook_event_name: z.literal('Stop'),
});

export const PostToolUseHookEvent = BaseHookFields.extend({
	hook_event_name: z.literal('PostToolUse'),
	tool_name: z.string(),
	tool_input: z.record(z.string(), z.unknown()).optional(),
	tool_response: z.record(z.string(), z.unknown()).optional(),
});

export const TaskCompletedHookEvent = BaseHookFields.extend({
	hook_event_name: z.literal('TaskCompleted'),
	task_id: z.string().optional(),
	task_subject: z.string().optional(),
	task_description: z.string().optional(),
});

export const WorktreeCreateHookEvent = BaseHookFields.extend({
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
