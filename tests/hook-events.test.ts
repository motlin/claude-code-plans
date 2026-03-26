import {describe, expect, it} from 'vitest';
import {deriveEventFromPath, SSE_EVENTS, HookEventEnvelope} from '../src/lib/hook-events';

const PLANS_DIR = '/home/user/.claude/plans';
const PROJECTS_DIR = '/home/user/.claude/projects';

describe('deriveEventFromPath', () => {
	it('identifies session JSONL updates', () => {
		const event = deriveEventFromPath(
			'/home/user/.claude/projects/my-project/abc123.jsonl',
			PLANS_DIR,
			PROJECTS_DIR,
		);
		expect(event.type).toBe(SSE_EVENTS.SESSION_UPDATE);
		expect(event.data).toEqual({sessionId: 'abc123', projectDir: 'my-project'});
	});

	it('identifies sessions-index.json reindex', () => {
		const event = deriveEventFromPath(
			'/home/user/.claude/projects/my-project/sessions-index.json',
			PLANS_DIR,
			PROJECTS_DIR,
		);
		expect(event.type).toBe(SSE_EVENTS.SESSIONS_REINDEXED);
		expect(event.data).toEqual({projectDir: 'my-project'});
	});

	it('identifies task file updates', () => {
		const event = deriveEventFromPath('/home/user/.claude/tasks/my-project/task-001.json', PLANS_DIR, PROJECTS_DIR);
		expect(event.type).toBe(SSE_EVENTS.TASK_UPDATED);
		expect(event.data).toEqual({projectDir: 'my-project', taskId: 'task-001'});
	});

	it('identifies plan file updates', () => {
		const event = deriveEventFromPath('/home/user/.claude/plans/my-plan.md', PLANS_DIR, PROJECTS_DIR);
		expect(event.type).toBe(SSE_EVENTS.PLAN_UPDATED);
		expect(event.data).toEqual({filename: 'my-plan.md'});
	});

	it('identifies memory file updates in project dir', () => {
		const event = deriveEventFromPath('/home/user/.claude/projects/my-project/MEMORY.md', PLANS_DIR, PROJECTS_DIR);
		expect(event.type).toBe(SSE_EVENTS.MEMORY_UPDATED);
		expect(event.data).toEqual({projectDir: 'my-project', filename: 'MEMORY.md'});
	});

	it('returns content:updated for unknown paths', () => {
		const event = deriveEventFromPath('/some/random/file.txt', PLANS_DIR, PROJECTS_DIR);
		expect(event.type).toBe(SSE_EVENTS.CONTENT_UPDATED);
	});
});

describe('HookEventEnvelope', () => {
	it('parses SessionStart event', () => {
		const result = HookEventEnvelope.safeParse({
			session_id: 'abc123',
			hook_event_name: 'SessionStart',
			cwd: '/home/user/project',
			model: 'claude-sonnet-4-6',
			source: 'startup',
		});
		expect(result.success).toBe(true);
	});

	it('parses PostToolUse event', () => {
		const result = HookEventEnvelope.safeParse({
			session_id: 'abc123',
			hook_event_name: 'PostToolUse',
			tool_name: 'Write',
			tool_input: {file_path: '/tmp/test.ts', content: 'hello'},
		});
		expect(result.success).toBe(true);
	});

	it('parses TaskCompleted event', () => {
		const result = HookEventEnvelope.safeParse({
			session_id: 'abc123',
			hook_event_name: 'TaskCompleted',
			task_id: 'task-001',
			task_subject: 'Build auth',
		});
		expect(result.success).toBe(true);
	});

	it('rejects unknown event types', () => {
		const result = HookEventEnvelope.safeParse({
			session_id: 'abc123',
			hook_event_name: 'Unknown',
		});
		expect(result.success).toBe(false);
	});
});
