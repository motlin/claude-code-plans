import {describe, expect, it} from 'vitest';
import {SSE_EVENTS, DOMAIN_EVENTS, HookEventEnvelope, diffEntityMaps} from '../src/lib/hook-events';

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
		expect(DOMAIN_EVENTS.MEMORY_REMOVED).toBe('memory:removed');
		expect(DOMAIN_EVENTS.TASK_CHANGED).toBe('task:changed');
		expect(DOMAIN_EVENTS.TASK_COMPLETED).toBe('task:completed');
	});

	it('remains distinct from the surviving SSE_EVENTS lifecycle signals', () => {
		// The surviving SESSION_START / SESSION_END lifecycle signals must stay
		// distinct from the new added / removed / updated domain deltas.
		expect(DOMAIN_EVENTS.SESSION_ADDED).not.toBe(SSE_EVENTS.SESSION_START);
		expect(DOMAIN_EVENTS.SESSION_REMOVED).not.toBe(SSE_EVENTS.SESSION_END);
		expect(DOMAIN_EVENTS.SESSION_STARTED).not.toBe(SSE_EVENTS.SESSION_START);
		expect(DOMAIN_EVENTS.SESSION_ENDED).not.toBe(SSE_EVENTS.SESSION_END);
	});
});

describe('diffEntityMaps', () => {
	type Entity = {id: string; version: number};
	const equals = (a: Entity, b: Entity) => a.version === b.version;

	it('detects added entries present in next but not previous', () => {
		const previous = new Map<string, Entity>();
		const next = new Map([['a', {id: 'a', version: 1}]]);

		expect(diffEntityMaps(previous, next, equals)).toStrictEqual({
			added: [{id: 'a', version: 1}],
			removed: [],
			updated: [],
		});
	});

	it('detects removed entries present in previous but not next', () => {
		const previous = new Map([['a', {id: 'a', version: 1}]]);
		const next = new Map<string, Entity>();

		expect(diffEntityMaps(previous, next, equals)).toStrictEqual({
			added: [],
			removed: ['a'],
			updated: [],
		});
	});

	it('detects updated entries whose value differs by the custom comparator', () => {
		const previous = new Map([['a', {id: 'a', version: 1}]]);
		const next = new Map([['a', {id: 'a', version: 2}]]);

		expect(diffEntityMaps(previous, next, equals)).toStrictEqual({
			added: [],
			removed: [],
			updated: [{id: 'a', version: 2}],
		});
	});

	it('treats equal entries as unchanged', () => {
		const previous = new Map([['a', {id: 'a', version: 1}]]);
		const next = new Map([['a', {id: 'a', version: 1}]]);

		expect(diffEntityMaps(previous, next, equals)).toStrictEqual({
			added: [],
			removed: [],
			updated: [],
		});
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

		expect(diffEntityMaps(previous, next, equals)).toStrictEqual({
			added: [{id: 'c', version: 1}],
			removed: ['a'],
			updated: [{id: 'b', version: 2}],
		});
	});
});
