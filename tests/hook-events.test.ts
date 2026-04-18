import {describe, expect, it} from 'vitest';
import {
	deriveEventFromPath,
	SSE_EVENTS,
	DOMAIN_EVENTS,
	HookEventEnvelope,
	diffEntityMaps,
} from '../src/lib/hook-events';

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

describe('DOMAIN_EVENTS', () => {
	it('exposes the new domain-level event vocabulary', () => {
		expect(DOMAIN_EVENTS.SESSION_ADDED).toBe('session:added');
		expect(DOMAIN_EVENTS.SESSION_REMOVED).toBe('session:removed');
		expect(DOMAIN_EVENTS.SESSION_UPDATED).toBe('session:updated');
		expect(DOMAIN_EVENTS.SESSION_STARTED).toBe('session:started');
		expect(DOMAIN_EVENTS.SESSION_ENDED).toBe('session:ended');
		expect(DOMAIN_EVENTS.PLAN_CHANGED).toBe('plan:changed');
		expect(DOMAIN_EVENTS.PLAN_REMOVED).toBe('plan:removed');
		expect(DOMAIN_EVENTS.MEMORY_CHANGED).toBe('memory:changed');
		expect(DOMAIN_EVENTS.TASK_CHANGED).toBe('task:changed');
		expect(DOMAIN_EVENTS.TASK_COMPLETED).toBe('task:completed');
	});

	it('does not collide with the legacy SSE_EVENTS namespace for new deltas', () => {
		// The legacy SESSION_START / SESSION_END / SESSION_UPDATE values must
		// remain distinct from the new added / removed / updated deltas so both
		// namespaces can coexist during the migration.
		expect(DOMAIN_EVENTS.SESSION_ADDED).not.toBe(SSE_EVENTS.SESSION_START);
		expect(DOMAIN_EVENTS.SESSION_REMOVED).not.toBe(SSE_EVENTS.SESSION_END);
		expect(DOMAIN_EVENTS.SESSION_UPDATED).not.toBe(SSE_EVENTS.SESSION_UPDATE);
		expect(DOMAIN_EVENTS.PLAN_CHANGED).not.toBe(SSE_EVENTS.PLAN_UPDATED);
		expect(DOMAIN_EVENTS.MEMORY_CHANGED).not.toBe(SSE_EVENTS.MEMORY_UPDATED);
		expect(DOMAIN_EVENTS.TASK_CHANGED).not.toBe(SSE_EVENTS.TASK_UPDATED);
	});
});

describe('diffEntityMaps', () => {
	type Entity = {id: string; version: number};
	const equals = (a: Entity, b: Entity) => a.version === b.version;

	it('detects added entries present in next but not previous', () => {
		const previous = new Map<string, Entity>();
		const next = new Map([['a', {id: 'a', version: 1}]]);

		const diff = diffEntityMaps(previous, next, equals);

		expect(diff.added).toEqual([{id: 'a', version: 1}]);
		expect(diff.removed).toEqual([]);
		expect(diff.updated).toEqual([]);
	});

	it('detects removed entries present in previous but not next', () => {
		const previous = new Map([['a', {id: 'a', version: 1}]]);
		const next = new Map<string, Entity>();

		const diff = diffEntityMaps(previous, next, equals);

		expect(diff.added).toEqual([]);
		expect(diff.removed).toEqual(['a']);
		expect(diff.updated).toEqual([]);
	});

	it('detects updated entries whose value differs by the custom comparator', () => {
		const previous = new Map([['a', {id: 'a', version: 1}]]);
		const next = new Map([['a', {id: 'a', version: 2}]]);

		const diff = diffEntityMaps(previous, next, equals);

		expect(diff.added).toEqual([]);
		expect(diff.removed).toEqual([]);
		expect(diff.updated).toEqual([{id: 'a', version: 2}]);
	});

	it('treats equal entries as unchanged', () => {
		const previous = new Map([['a', {id: 'a', version: 1}]]);
		const next = new Map([['a', {id: 'a', version: 1}]]);

		const diff = diffEntityMaps(previous, next, equals);

		expect(diff.added).toEqual([]);
		expect(diff.removed).toEqual([]);
		expect(diff.updated).toEqual([]);
	});

	it('handles mixed adds, removes, and updates in a single pass', () => {
		const previous = new Map([
			['a', {id: 'a', version: 1}],
			['b', {id: 'b', version: 1}],
		]);
		const next = new Map([
			['b', {id: 'b', version: 2}],
			['c', {id: 'c', version: 1}],
		]);

		const diff = diffEntityMaps(previous, next, equals);

		expect(diff.added).toEqual([{id: 'c', version: 1}]);
		expect(diff.removed).toEqual(['a']);
		expect(diff.updated).toEqual([{id: 'b', version: 2}]);
	});
});
