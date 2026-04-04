import {z} from 'zod';

// ---------------------------------------------------------------------------
// SSE Event Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// SSE Event Payloads (sent to client)
// ---------------------------------------------------------------------------

export interface SseEvent {
	type: SseEventType;
	data: Record<string, unknown>;
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
