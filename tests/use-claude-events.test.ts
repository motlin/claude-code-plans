import {describe, it, expect} from 'vitest';
import {QueryClient} from '@tanstack/react-query';
import {
	applyMemoryChanged,
	applyPlanChanged,
	applyPlanRemoved,
	applySessionAdded,
	applySessionRemoved,
	applySessionUpdated,
	applyTaskChanged,
	claudeEventsReducer,
	type ClaudeEventsState,
	type ClaudeEventsAction,
} from '../src/hooks/use-claude-events';
import type {MemorySummaryPayload, PlanSummaryPayload, SessionSummaryPayload} from '../src/lib/hook-events';

function makeSession(overrides: Partial<SessionSummaryPayload> & {id: string; project: string}): SessionSummaryPayload {
	const {id, project, ...rest} = overrides;
	return {
		id,
		title: `Session ${id}`,
		summary: undefined,
		mtime: '2026-04-18T00:00:00.000Z',
		created: '2026-04-18T00:00:00.000Z',
		project,
		projectName: `Project ${project}`,
		messageCount: 0,
		gitBranch: undefined,
		...rest,
	};
}

function makePlan(filename: string, title = filename): PlanSummaryPayload {
	return {filename, title, mtime: '2026-04-18T00:00:00.000Z'};
}

function makeMemory(project: string, filename: string, title = filename): MemorySummaryPayload {
	return {
		filename,
		title,
		mtime: '2026-04-18T00:00:00.000Z',
		project,
		projectName: `Project ${project}`,
	};
}

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
		expect(next.activeSessions.get('abc-123')).toStrictEqual({
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

	it('handles domain session:updated by touching lastActivity via the session payload id', () => {
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
			eventType: 'session:updated',
			data: {session: {id: 'abc-123'}},
			timestamp: 3000,
		};
		const next = claudeEventsReducer(state, action);
		expect(next.activeSessions.get('abc-123')?.lastActivity).toBe(3000);
	});

	it('ignores non-lifecycle events without mutating state', () => {
		const state = makeInitialState();
		const action: ClaudeEventsAction = {
			type: 'SSE_EVENT',
			eventType: 'task:changed',
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

	it('session:updated for unknown session does not add it', () => {
		const state = makeInitialState();
		const action: ClaudeEventsAction = {
			type: 'SSE_EVENT',
			eventType: 'session:updated',
			data: {session: {id: 'unknown-id'}},
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

describe('applySessionAdded', () => {
	it('prepends a new session to an existing project group', () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData(
			['sessions'],
			[{project: 'proj-a', projectName: 'Project A', sessions: [makeSession({id: 'old', project: 'proj-a'})]}],
		);

		applySessionAdded(queryClient, makeSession({id: 'new', project: 'proj-a'}));

		const groups = queryClient.getQueryData<Array<{project: string; sessions: SessionSummaryPayload[]}>>([
			'sessions',
		]);
		expect(groups?.length).toBe(1);
		expect(groups?.[0]?.sessions.map((s) => s.id)).toStrictEqual(['new', 'old']);
	});

	it('creates a new project group when the session is from a new project', () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData(
			['sessions'],
			[{project: 'proj-a', projectName: 'Project A', sessions: [makeSession({id: 'a1', project: 'proj-a'})]}],
		);

		applySessionAdded(queryClient, makeSession({id: 'b1', project: 'proj-b'}));

		const groups = queryClient.getQueryData<Array<{project: string; sessions: SessionSummaryPayload[]}>>([
			'sessions',
		]);
		expect(groups?.map((g) => g.project)).toStrictEqual(['proj-a', 'proj-b']);
	});

	it('replaces an existing session in place when the id already exists', () => {
		const queryClient = new QueryClient();
		const existing = makeSession({id: 'a1', project: 'proj-a', title: 'Old title'});
		queryClient.setQueryData(['sessions'], [{project: 'proj-a', projectName: 'Project A', sessions: [existing]}]);

		applySessionAdded(queryClient, makeSession({id: 'a1', project: 'proj-a', title: 'New title'}));

		const groups = queryClient.getQueryData<Array<{project: string; sessions: SessionSummaryPayload[]}>>([
			'sessions',
		]);
		expect(groups?.[0]?.sessions.length).toBe(1);
		expect(groups?.[0]?.sessions[0]?.title).toBe('New title');
	});

	it('is a no-op when the sessions query has never been populated', () => {
		const queryClient = new QueryClient();
		applySessionAdded(queryClient, makeSession({id: 'a1', project: 'proj-a'}));
		expect(queryClient.getQueryData(['sessions'])).toBe(undefined);
	});
});

describe('applySessionRemoved', () => {
	it('removes the session from its project group', () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData(
			['sessions'],
			[
				{
					project: 'proj-a',
					projectName: 'Project A',
					sessions: [makeSession({id: 'a1', project: 'proj-a'}), makeSession({id: 'a2', project: 'proj-a'})],
				},
			],
		);

		applySessionRemoved(queryClient, 'a1', 'proj-a');

		const groups = queryClient.getQueryData<Array<{project: string; sessions: SessionSummaryPayload[]}>>([
			'sessions',
		]);
		expect(groups?.[0]?.sessions.map((s) => s.id)).toStrictEqual(['a2']);
	});

	it('drops the project group when its last session is removed', () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData(
			['sessions'],
			[{project: 'proj-a', projectName: 'Project A', sessions: [makeSession({id: 'a1', project: 'proj-a'})]}],
		);

		applySessionRemoved(queryClient, 'a1', 'proj-a');

		const groups = queryClient.getQueryData<Array<{project: string; sessions: SessionSummaryPayload[]}>>([
			'sessions',
		]);
		expect(groups).toStrictEqual([]);
	});

	it('also filters the starred-sessions cache', () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData(
			['starred-sessions'],
			[makeSession({id: 'a1', project: 'proj-a'}), makeSession({id: 'a2', project: 'proj-a'})],
		);

		applySessionRemoved(queryClient, 'a1', 'proj-a');

		const starred = queryClient.getQueryData<SessionSummaryPayload[]>(['starred-sessions']);
		expect(starred?.map((s) => s.id)).toStrictEqual(['a2']);
	});

	it('evicts every per-session sub-cache under ["session", id, ...]', () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData(['session', 'a1', 'detail'], {id: 'a1'});
		queryClient.setQueryData(['session', 'a1', 'subagents'], [{name: 'planner'}]);
		queryClient.setQueryData(['session', 'a1', 'summary'], {text: 'hello'});
		queryClient.setQueryData(['session', 'a1', 'starred'], true);
		// Unrelated session cache should survive.
		queryClient.setQueryData(['session', 'a2', 'detail'], {id: 'a2'});

		applySessionRemoved(queryClient, 'a1', 'proj-a');

		expect(queryClient.getQueryData(['session', 'a1', 'detail'])).toBe(undefined);
		expect(queryClient.getQueryData(['session', 'a1', 'subagents'])).toBe(undefined);
		expect(queryClient.getQueryData(['session', 'a1', 'summary'])).toBe(undefined);
		expect(queryClient.getQueryData(['session', 'a1', 'starred'])).toBe(undefined);
		expect(queryClient.getQueryData(['session', 'a2', 'detail'])).toStrictEqual({id: 'a2'});
	});
});

describe('applySessionUpdated', () => {
	it('replaces the matching session in the sessions group', () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData(
			['sessions'],
			[
				{
					project: 'proj-a',
					projectName: 'Project A',
					sessions: [makeSession({id: 'a1', project: 'proj-a', title: 'Old'})],
				},
			],
		);

		applySessionUpdated(queryClient, makeSession({id: 'a1', project: 'proj-a', title: 'New'}));

		const groups = queryClient.getQueryData<Array<{project: string; sessions: SessionSummaryPayload[]}>>([
			'sessions',
		]);
		expect(groups?.[0]?.sessions[0]?.title).toBe('New');
	});

	it('also patches the starred-sessions cache', () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData(['starred-sessions'], [makeSession({id: 'a1', project: 'proj-a', title: 'Old'})]);

		applySessionUpdated(queryClient, makeSession({id: 'a1', project: 'proj-a', title: 'New'}));

		const starred = queryClient.getQueryData<SessionSummaryPayload[]>(['starred-sessions']);
		expect(starred?.[0]?.title).toBe('New');
	});
});

describe('applyPlanChanged', () => {
	it('prepends a new plan to the flat plans cache', () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData(['plans'], [makePlan('old.md')]);

		applyPlanChanged(queryClient, makePlan('new.md'));

		const plans = queryClient.getQueryData<PlanSummaryPayload[]>(['plans']);
		expect(plans?.map((p) => p.filename)).toStrictEqual(['new.md', 'old.md']);
	});

	it('replaces an existing plan in place when its filename already exists', () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData(['plans'], [makePlan('a.md', 'Old title')]);

		applyPlanChanged(queryClient, makePlan('a.md', 'New title'));

		const plans = queryClient.getQueryData<PlanSummaryPayload[]>(['plans']);
		expect(plans?.length).toBe(1);
		expect(plans?.[0]?.title).toBe('New title');
	});

	it('leaves the cache untouched when it was empty', () => {
		const queryClient = new QueryClient();
		applyPlanChanged(queryClient, makePlan('first.md'));

		const plans = queryClient.getQueryData<PlanSummaryPayload[]>(['plans']);
		expect(plans).toBe(undefined);
	});
});

describe('applyPlanRemoved', () => {
	it('filters the plan out of the flat plans cache', () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData(['plans'], [makePlan('a.md'), makePlan('b.md')]);

		applyPlanRemoved(queryClient, 'a.md');

		const plans = queryClient.getQueryData<PlanSummaryPayload[]>(['plans']);
		expect(plans?.map((p) => p.filename)).toStrictEqual(['b.md']);
	});

	it('filters the plan out of grouped caches, dropping empty groups', () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData(
			['plans', 'grouped'],
			[
				{projectId: 'p1', projectName: 'P1', plans: [makePlan('a.md')]},
				{projectId: 'p2', projectName: 'P2', plans: [makePlan('a.md'), makePlan('b.md')]},
			],
		);

		applyPlanRemoved(queryClient, 'a.md');

		const grouped = queryClient.getQueryData<Array<{projectId: string; plans: PlanSummaryPayload[]}>>([
			'plans',
			'grouped',
		]);
		expect(grouped?.map((g) => g.projectId)).toStrictEqual(['p2']);
		expect(grouped?.[0]?.plans.map((p) => p.filename)).toStrictEqual(['b.md']);
	});
});

describe('applyMemoryChanged', () => {
	it('replaces an existing memory in the matching project group', () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData(
			['memories'],
			[
				{
					project: 'proj-a',
					projectName: 'Project A',
					memories: [
						{filename: 'MEMORY.md', title: 'Old', mtime: '2026-04-17T00:00:00.000Z', project: 'proj-a'},
					],
				},
			],
		);

		applyMemoryChanged(queryClient, makeMemory('proj-a', 'MEMORY.md', 'New'));

		const groups = queryClient.getQueryData<
			Array<{project: string; memories: Array<{filename: string; title: string}>}>
		>(['memories']);
		expect(groups?.[0]?.memories.length).toBe(1);
		expect(groups?.[0]?.memories[0]?.title).toBe('New');
	});

	it('creates a new project group when the memory is from a new project', () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData(['memories'], [{project: 'proj-a', projectName: 'Project A', memories: []}]);

		applyMemoryChanged(queryClient, makeMemory('proj-b', 'MEMORY.md'));

		const groups = queryClient.getQueryData<Array<{project: string; memories: Array<{filename: string}>}>>([
			'memories',
		]);
		expect(groups?.map((g) => g.project)).toStrictEqual(['proj-a', 'proj-b']);
		expect(groups?.[1]?.memories.map((m) => m.filename)).toStrictEqual(['MEMORY.md']);
	});
});

describe('applyTaskChanged', () => {
	it('invalidates both the global and per-project task queries', () => {
		const queryClient = new QueryClient();
		// Prime two task queries.
		queryClient.setQueryData(['tasks'], []);
		queryClient.setQueryData(['tasks', 'project', 'proj-a'], []);

		applyTaskChanged(queryClient, 'proj-a');

		const globalState = queryClient.getQueryState(['tasks']);
		const projectState = queryClient.getQueryState(['tasks', 'project', 'proj-a']);
		expect(globalState?.isInvalidated).toBe(true);
		expect(projectState?.isInvalidated).toBe(true);
	});
});
