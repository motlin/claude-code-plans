import {describe, it, expect} from 'vitest';
import {
	claudeEventsReducer,
	shouldInvalidateRoute,
	type ClaudeEventsState,
	type ClaudeEventsAction,
} from '../src/hooks/use-claude-events';

function makeInitialState(): ClaudeEventsState {
	return {
		activeSessions: new Map(),
		lastEventByType: new Map(),
		lastEventTimestamp: 0,
	};
}

describe('claudeEventsReducer', () => {
	it('handles session:start by adding to activeSessions', () => {
		const state = makeInitialState();
		const action: ClaudeEventsAction = {
			type: 'SSE_EVENT',
			eventType: 'session:start',
			data: {sessionId: 'abc-123', cwd: '/home/user/project', model: 'opus'},
			timestamp: 1000,
		};
		const next = claudeEventsReducer(state, action);
		expect(next.activeSessions.has('abc-123')).toBe(true);
		expect(next.activeSessions.get('abc-123')).toEqual({
			sessionId: 'abc-123',
			cwd: '/home/user/project',
			model: 'opus',
			startedAt: 1000,
			lastActivity: 1000,
		});
		expect(next.lastEventByType.get('session:start')).toBe(1000);
		expect(next.lastEventTimestamp).toBe(1000);
	});

	it('handles session:end by removing from activeSessions', () => {
		const state = makeInitialState();
		state.activeSessions.set('abc-123', {
			sessionId: 'abc-123',
			cwd: '/home/user/project',
			model: 'opus',
			startedAt: 1000,
			lastActivity: 1000,
		});
		const action: ClaudeEventsAction = {
			type: 'SSE_EVENT',
			eventType: 'session:end',
			data: {sessionId: 'abc-123'},
			timestamp: 2000,
		};
		const next = claudeEventsReducer(state, action);
		expect(next.activeSessions.has('abc-123')).toBe(false);
		expect(next.lastEventByType.get('session:end')).toBe(2000);
	});

	it('handles session:update by touching lastActivity', () => {
		const state = makeInitialState();
		state.activeSessions.set('abc-123', {
			sessionId: 'abc-123',
			cwd: '/home/user/project',
			model: 'opus',
			startedAt: 1000,
			lastActivity: 1000,
		});
		const action: ClaudeEventsAction = {
			type: 'SSE_EVENT',
			eventType: 'session:update',
			data: {sessionId: 'abc-123'},
			timestamp: 3000,
		};
		const next = claudeEventsReducer(state, action);
		expect(next.activeSessions.get('abc-123')?.lastActivity).toBe(3000);
	});

	it('tracks lastEventByType for all event types', () => {
		const state = makeInitialState();
		const action: ClaudeEventsAction = {
			type: 'SSE_EVENT',
			eventType: 'task:updated',
			data: {taskId: 'task-1'},
			timestamp: 5000,
		};
		const next = claudeEventsReducer(state, action);
		expect(next.lastEventByType.get('task:updated')).toBe(5000);
		expect(next.lastEventTimestamp).toBe(5000);
	});

	it('does not mutate the original state', () => {
		const state = makeInitialState();
		const action: ClaudeEventsAction = {
			type: 'SSE_EVENT',
			eventType: 'session:start',
			data: {sessionId: 'abc-123', cwd: '/tmp'},
			timestamp: 1000,
		};
		const next = claudeEventsReducer(state, action);
		expect(state.activeSessions.size).toBe(0);
		expect(next.activeSessions.size).toBe(1);
	});

	it('session:update for unknown session does not add it', () => {
		const state = makeInitialState();
		const action: ClaudeEventsAction = {
			type: 'SSE_EVENT',
			eventType: 'session:update',
			data: {sessionId: 'unknown-id'},
			timestamp: 1000,
		};
		const next = claudeEventsReducer(state, action);
		expect(next.activeSessions.has('unknown-id')).toBe(false);
	});

	it('handles RESET action', () => {
		const state = makeInitialState();
		state.activeSessions.set('abc-123', {
			sessionId: 'abc-123',
			cwd: '/tmp',
			model: '',
			startedAt: 1000,
			lastActivity: 1000,
		});
		state.lastEventByType.set('session:start', 1000);
		state.lastEventTimestamp = 1000;
		const action: ClaudeEventsAction = {type: 'RESET'};
		const next = claudeEventsReducer(state, action);
		expect(next.activeSessions.size).toBe(0);
		expect(next.lastEventByType.size).toBe(0);
		expect(next.lastEventTimestamp).toBe(0);
	});
});

describe('shouldInvalidateRoute', () => {
	// --- session:start / session:end ---
	it('session:start invalidates /active', () => {
		expect(shouldInvalidateRoute('session:start', {}, '/active')).toBe(true);
	});

	it('session:start invalidates /sessions', () => {
		expect(shouldInvalidateRoute('session:start', {}, '/sessions')).toBe(true);
	});

	it('session:start invalidates / (home)', () => {
		expect(shouldInvalidateRoute('session:start', {}, '/')).toBe(true);
	});

	it('session:start does not invalidate /plans', () => {
		expect(shouldInvalidateRoute('session:start', {}, '/plans')).toBe(false);
	});

	it('session:end invalidates /active', () => {
		expect(shouldInvalidateRoute('session:end', {}, '/active')).toBe(true);
	});

	it('session:end does not invalidate /memories', () => {
		expect(shouldInvalidateRoute('session:end', {}, '/memories')).toBe(false);
	});

	// --- session:update ---
	it('session:update invalidates /session/$id when IDs match', () => {
		expect(shouldInvalidateRoute('session:update', {sessionId: 'abc-123'}, '/session/abc-123')).toBe(true);
	});

	it('session:update does not invalidate /session/$id when IDs differ', () => {
		expect(shouldInvalidateRoute('session:update', {sessionId: 'abc-123'}, '/session/other-456')).toBe(false);
	});

	it('session:update invalidates /active', () => {
		expect(shouldInvalidateRoute('session:update', {sessionId: 'abc-123'}, '/active')).toBe(true);
	});

	it('session:update invalidates /sessions', () => {
		expect(shouldInvalidateRoute('session:update', {sessionId: 'abc-123'}, '/sessions')).toBe(true);
	});

	it('session:update does not invalidate /plans', () => {
		expect(shouldInvalidateRoute('session:update', {sessionId: 'abc-123'}, '/plans')).toBe(false);
	});

	// --- sessions:reindexed ---
	it('sessions:reindexed invalidates /sessions', () => {
		expect(shouldInvalidateRoute('sessions:reindexed', {}, '/sessions')).toBe(true);
	});

	it('sessions:reindexed invalidates /projects', () => {
		expect(shouldInvalidateRoute('sessions:reindexed', {}, '/projects')).toBe(true);
	});

	it('sessions:reindexed invalidates /project/$id', () => {
		expect(shouldInvalidateRoute('sessions:reindexed', {}, '/project/my-project')).toBe(true);
	});

	it('sessions:reindexed invalidates /', () => {
		expect(shouldInvalidateRoute('sessions:reindexed', {}, '/')).toBe(true);
	});

	it('sessions:reindexed invalidates /search', () => {
		expect(shouldInvalidateRoute('sessions:reindexed', {}, '/search')).toBe(true);
	});

	it('sessions:reindexed invalidates /starred', () => {
		expect(shouldInvalidateRoute('sessions:reindexed', {}, '/starred')).toBe(true);
	});

	it('sessions:reindexed does not invalidate /plans', () => {
		expect(shouldInvalidateRoute('sessions:reindexed', {}, '/plans')).toBe(false);
	});

	// --- task:updated / task:completed ---
	it('task:updated invalidates /project/$id', () => {
		expect(shouldInvalidateRoute('task:updated', {}, '/project/my-project')).toBe(true);
	});

	it('task:completed invalidates /project/$id', () => {
		expect(shouldInvalidateRoute('task:completed', {}, '/project/my-project')).toBe(true);
	});

	it('task:updated does not invalidate /sessions', () => {
		expect(shouldInvalidateRoute('task:updated', {}, '/sessions')).toBe(false);
	});

	// --- plan:updated ---
	it('plan:updated invalidates /plans', () => {
		expect(shouldInvalidateRoute('plan:updated', {}, '/plans')).toBe(true);
	});

	it('plan:updated invalidates /plan/$filename', () => {
		expect(shouldInvalidateRoute('plan:updated', {}, '/plan/my-plan')).toBe(true);
	});

	it('plan:updated does not invalidate /sessions', () => {
		expect(shouldInvalidateRoute('plan:updated', {}, '/sessions')).toBe(false);
	});

	// --- memory:updated ---
	it('memory:updated invalidates /memories', () => {
		expect(shouldInvalidateRoute('memory:updated', {}, '/memories')).toBe(true);
	});

	it('memory:updated invalidates /memory/$project/$filename', () => {
		expect(shouldInvalidateRoute('memory:updated', {}, '/memory/proj/MEMORY.md')).toBe(true);
	});

	it('memory:updated does not invalidate /sessions', () => {
		expect(shouldInvalidateRoute('memory:updated', {}, '/sessions')).toBe(false);
	});

	// --- content:updated (catch-all) ---
	it('content:updated always invalidates', () => {
		expect(shouldInvalidateRoute('content:updated', {}, '/plans')).toBe(true);
		expect(shouldInvalidateRoute('content:updated', {}, '/sessions')).toBe(true);
		expect(shouldInvalidateRoute('content:updated', {}, '/')).toBe(true);
	});

	// --- unknown event type ---
	it('unknown event types always invalidate', () => {
		expect(shouldInvalidateRoute('some:unknown', {}, '/plans')).toBe(true);
	});

	// --- worktree:created ---
	it('worktree:created invalidates /project/$id', () => {
		expect(shouldInvalidateRoute('worktree:created', {}, '/project/my-project')).toBe(true);
	});

	it('worktree:created does not invalidate /plans', () => {
		expect(shouldInvalidateRoute('worktree:created', {}, '/plans')).toBe(false);
	});
});
