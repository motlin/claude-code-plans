import {z} from 'zod';

// ---------------------------------------------------------------------------
// SSE Event Types
// ---------------------------------------------------------------------------

/**
 * Legacy file-system-level SSE event names. Preserved while the client
 * migrates to the domain-level DOMAIN_EVENTS vocabulary below. These will
 * be deleted in the final cleanup task (see plan step "Delete old event
 * infrastructure and file-level SSE events").
 */
export const SSE_EVENTS = {
	SESSION_START: 'session:start',
	SESSION_END: 'session:end',
	SESSION_UPDATE: 'session:update',
	SESSIONS_REINDEXED: 'sessions:reindexed',
	TASK_UPDATED: 'task:updated',
	TASK_COMPLETED: 'task:completed',
	PLAN_UPDATED: 'plan:updated',
	MEMORY_UPDATED: 'memory:updated',
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

export interface SseEvent {
	type: SseEventType;
	data: Record<string, unknown>;
}

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

export interface DomainEventPayloads {
	[DOMAIN_EVENTS.SESSION_ADDED]: {session: SessionSummaryPayload};
	[DOMAIN_EVENTS.SESSION_REMOVED]: {sessionId: string; projectDir: string};
	[DOMAIN_EVENTS.SESSION_UPDATED]: {session: SessionSummaryPayload};
	[DOMAIN_EVENTS.SESSION_STARTED]: {session: ActiveSessionPayload};
	[DOMAIN_EVENTS.SESSION_ENDED]: {sessionId: string};
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function deriveEventFromPath(filePath: string, plansDir: string, projectsDir: string): SseEvent {
	// .jsonl session files: ~/.claude/projects/{projectDir}/{sessionId}.jsonl
	if (filePath.endsWith('.jsonl') && filePath.includes(projectsDir)) {
		const relative = filePath.slice(projectsDir.length + 1);
		const parts = relative.split('/');
		const projectDir = parts[0] ?? '';
		const filename = parts[parts.length - 1] ?? '';
		const sessionId = filename.replace(/\.jsonl$/, '');
		return {type: SSE_EVENTS.SESSION_UPDATE, data: {sessionId, projectDir}};
	}

	// sessions-index.json
	if (filePath.endsWith('sessions-index.json') && filePath.includes(projectsDir)) {
		const relative = filePath.slice(projectsDir.length + 1);
		const projectDir = relative.split('/')[0] ?? '';
		return {type: SSE_EVENTS.SESSIONS_REINDEXED, data: {projectDir}};
	}

	// Task files: ~/.claude/tasks/{projectName}/{taskId}.json
	if (filePath.endsWith('.json') && filePath.includes('/tasks/')) {
		const parts = filePath.split('/');
		const taskFile = parts[parts.length - 1] ?? '';
		const projectDir = parts[parts.length - 2] ?? '';
		const taskId = taskFile.replace(/\.json$/, '');
		return {type: SSE_EVENTS.TASK_UPDATED, data: {projectDir, taskId}};
	}

	// Plan files: ~/.claude/plans/{filename}.md
	if (filePath.endsWith('.md') && filePath.includes(plansDir)) {
		const filename = filePath.split('/').pop() ?? '';
		return {type: SSE_EVENTS.PLAN_UPDATED, data: {filename}};
	}

	// Memory files: ~/.claude/projects/{projectDir}/MEMORY.md or memory files
	if (filePath.endsWith('.md') && filePath.includes(projectsDir)) {
		const relative = filePath.slice(projectsDir.length + 1);
		const projectDir = relative.split('/')[0] ?? '';
		const filename = filePath.split('/').pop() ?? '';
		return {type: SSE_EVENTS.MEMORY_UPDATED, data: {projectDir, filename}};
	}

	// Catch-all
	return {type: SSE_EVENTS.CONTENT_UPDATED, data: {filePath}};
}
