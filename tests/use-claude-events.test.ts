import {describe, it, expect} from 'vitest';
import {claudeEventsReducer, type ClaudeEventsState, type ClaudeEventsAction} from '../src/hooks/use-claude-events';

function makeInitialState(): ClaudeEventsState {
	return {
		activeSessions: new Map(),
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

	it('ignores non-lifecycle events without mutating state', () => {
		const state = makeInitialState();
		const action: ClaudeEventsAction = {
			type: 'SSE_EVENT',
			eventType: 'task:updated',
			data: {taskId: 'task-1'},
			timestamp: 5000,
		};
		const next = claudeEventsReducer(state, action);
		expect(next).toBe(state);
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
		const action: ClaudeEventsAction = {type: 'RESET'};
		const next = claudeEventsReducer(state, action);
		expect(next.activeSessions.size).toBe(0);
	});
});
