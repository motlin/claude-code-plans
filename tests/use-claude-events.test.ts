import {describe, it, expect} from 'vitest';
import {QueryClient} from '@tanstack/react-query';
import {
	applyMemoryChanged,
	applyMemoryRemoved,
	applyPlanChanged,
	applyPlanRemoved,
	applySessionAdded,
	applySessionLinesAppended,
	applySessionRemoved,
	applySessionUpdated,
	applyTaskChanged,
	claudeEventsReducer,
	type ClaudeEventsState,
	type ClaudeEventsAction,
} from '../src/hooks/use-claude-events';
import type {MemorySummaryPayload, PlanSummaryPayload, SessionSummaryPayload} from '../src/lib/hook-events';
import type {TranscriptData} from '../src/lib/api/sessions';

function makeSession(overrides: Partial<SessionSummaryPayload> & {id: string; project: string}): SessionSummaryPayload {
	const {id, project, ...rest} = overrides;
	return {
		id,
		title: `Session ${id}`,
		summary: undefined,
		mtime: '1999-12-31T00:00:00.000Z',
		created: '1999-12-31T00:00:00.000Z',
		project,
		projectName: `Project ${project}`,
		messageCount: 0,
		gitBranch: undefined,
		starred: false,
		...rest,
	};
}

function makePlan(filename: string, title = filename): PlanSummaryPayload {
	return {filename, title, mtime: '1999-12-31T00:00:00.000Z'};
}

function makeMemory(project: string, filename: string, title = filename): MemorySummaryPayload {
	return {
		filename,
		title,
		mtime: '1999-12-31T00:00:00.000Z',
		project,
		projectName: `Project ${project}`,
	};
}

function makeInitialState(): ClaudeEventsState {
	return {
		activeSessions: new Map(),
		hookSchemaDrifts: new Map(),
		dismissedDrifts: new Set(),
		pendingTools: new Map(),
		compactingSessions: new Set(),
		notifications: new Map(),
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
		expect(next.hookSchemaDrifts.size).toBe(0);
		expect(next.dismissedDrifts.size).toBe(0);
	});

	it('records hook:schema-drift payloads keyed by hookEventName', () => {
		const state = makeInitialState();
		const action: ClaudeEventsAction = {
			type: 'SSE_EVENT',
			eventType: 'hook:schema-drift',
			data: {
				hookEventName: 'PostToolUse',
				missingFields: ['tool_response.foo'],
				unknownFields: ['tool_input.experimental_flag'],
				count: 3,
			},
			timestamp: 5000,
		};
		const next = claudeEventsReducer(state, action);
		expect(next.hookSchemaDrifts.get('PostToolUse')).toStrictEqual({
			hookEventName: 'PostToolUse',
			missingFields: ['tool_response.foo'],
			unknownFields: ['tool_input.experimental_flag'],
			count: 3,
		});
	});

	it('DISMISS_DRIFT hides the named drift until a fresh one arrives', () => {
		const state = makeInitialState();
		state.hookSchemaDrifts.set('PostToolUse', {
			hookEventName: 'PostToolUse',
			missingFields: [],
			unknownFields: ['x'],
			count: 1,
		});
		const dismissed = claudeEventsReducer(state, {type: 'DISMISS_DRIFT', hookEventName: 'PostToolUse'});
		expect(dismissed.dismissedDrifts.has('PostToolUse')).toBe(true);

		// A new drift for the same event clears the dismissal.
		const next = claudeEventsReducer(dismissed, {
			type: 'SSE_EVENT',
			eventType: 'hook:schema-drift',
			data: {hookEventName: 'PostToolUse', missingFields: [], unknownFields: ['y'], count: 2},
			timestamp: 6000,
		});
		expect(next.dismissedDrifts.has('PostToolUse')).toBe(false);
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

	it('invalidates all plan link queries', () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData(['sessions'], []);
		queryClient.setQueryData(['plans', 'plan-a.md', 'links'], [{sessionId: 's1'}]);
		queryClient.setQueryData(['plans', 'plan-b.md', 'links'], [{sessionId: 's2'}]);
		queryClient.setQueryData(['plans', 'plan-a.md'], {content: 'keep'});

		applySessionAdded(queryClient, makeSession({id: 'new-1', project: 'proj-a'}));

		expect(queryClient.getQueryState(['plans', 'plan-a.md', 'links'])?.isInvalidated).toBe(true);
		expect(queryClient.getQueryState(['plans', 'plan-b.md', 'links'])?.isInvalidated).toBe(true);
		// Plan detail should not be invalidated by session addition.
		expect(queryClient.getQueryState(['plans', 'plan-a.md'])?.isInvalidated).toBe(false);
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

	it('invalidates per-session sub-caches under ["session", id, ...] without removing data', () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData(['session', 'a1', 'detail'], {id: 'a1'});
		queryClient.setQueryData(['session', 'a1', 'subagents'], [{name: 'planner'}]);
		queryClient.setQueryData(['session', 'a1', 'summary'], {text: 'hello'});
		queryClient.setQueryData(['session', 'a1', 'starred'], true);
		// Unrelated session cache should survive.
		queryClient.setQueryData(['session', 'a2', 'detail'], {id: 'a2'});

		applySessionRemoved(queryClient, 'a1', 'proj-a');

		// Data remains in cache (invalidated, not removed) to prevent
		// useSuspenseQuery re-suspension loops.
		expect(queryClient.getQueryData(['session', 'a1', 'detail'])).toStrictEqual({id: 'a1'});
		expect(queryClient.getQueryData(['session', 'a1', 'subagents'])).toStrictEqual([{name: 'planner'}]);
		expect(queryClient.getQueryData(['session', 'a1', 'summary'])).toStrictEqual({text: 'hello'});
		expect(queryClient.getQueryData(['session', 'a1', 'starred'])).toBe(true);
		// Queries are invalidated (marked stale)
		const detailQuery = queryClient.getQueryCache().find({queryKey: ['session', 'a1', 'detail']});
		expect(detailQuery?.isStale()).toBe(true);
		// Unrelated session cache survives unchanged.
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

	it('invalidates session detail and summary queries', () => {
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
		queryClient.setQueryData(['session', 'a1', 'detail'], {lines: []});
		queryClient.setQueryData(['session', 'a1', 'summary'], {text: 'old summary'});

		applySessionUpdated(queryClient, makeSession({id: 'a1', project: 'proj-a', title: 'New'}));

		const detailState = queryClient.getQueryState(['session', 'a1', 'detail']);
		const summaryState = queryClient.getQueryState(['session', 'a1', 'summary']);
		expect(detailState?.isInvalidated).toBe(true);
		expect(summaryState?.isInvalidated).toBe(true);
	});
});

describe('applyPlanChanged', () => {
	it('invalidates the flat plans list so it refetches with up-to-date project links', () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData(['plans'], [makePlan('a.md')]);

		applyPlanChanged(queryClient, makePlan('a.md', 'Updated'));

		const plansState = queryClient.getQueryState(['plans']);
		expect(plansState?.isInvalidated).toBe(true);
	});

	it('invalidates plan detail and links queries for the changed plan', () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData(['plans'], [makePlan('a.md')]);
		queryClient.setQueryData(['plans', 'a.md'], {markdown: 'old', mtime: null, title: 'old'});
		queryClient.setQueryData(['plans', 'a.md', 'links'], []);

		applyPlanChanged(queryClient, makePlan('a.md', 'Updated'));

		const detailState = queryClient.getQueryState(['plans', 'a.md']);
		const linksState = queryClient.getQueryState(['plans', 'a.md', 'links']);
		expect(detailState?.isInvalidated).toBe(true);
		expect(linksState?.isInvalidated).toBe(true);
	});
});

describe('applyPlanRemoved', () => {
	it('invalidates the flat plans list and removes the per-plan detail caches', () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData(['plans'], [makePlan('a.md'), makePlan('b.md')]);
		queryClient.setQueryData(['plans', 'a.md'], {markdown: 'a', mtime: null, title: 'a'});
		queryClient.setQueryData(['plans', 'a.md', 'links'], []);

		applyPlanRemoved(queryClient, 'a.md');

		const plansState = queryClient.getQueryState(['plans']);
		expect(plansState?.isInvalidated).toBe(true);
		expect(queryClient.getQueryData(['plans', 'a.md'])).toBeUndefined();
		expect(queryClient.getQueryData(['plans', 'a.md', 'links'])).toBeUndefined();
	});
});

describe('applyMemoryChanged', () => {
	it('invalidates the project memory list and per-memory detail caches', () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData(['projects', 'proj-a', 'memories'], {
			project: {id: 'proj-a', name: 'Project A', projectPath: null},
			memories: [],
		});
		queryClient.setQueryData(['projects', 'proj-a', 'memories', 'MEMORY.md'], {
			markdown: 'old',
			mtime: null,
			projectName: 'Project A',
		});

		applyMemoryChanged(queryClient, makeMemory('proj-a', 'MEMORY.md', 'Updated'));

		const listState = queryClient.getQueryState(['projects', 'proj-a', 'memories']);
		const detailState = queryClient.getQueryState(['projects', 'proj-a', 'memories', 'MEMORY.md']);
		expect(listState?.isInvalidated).toBe(true);
		expect(detailState?.isInvalidated).toBe(true);
	});
});

describe('applyMemoryRemoved', () => {
	it('invalidates the project memory list and evicts the per-memory cache', () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData(['projects', 'proj-a', 'memories'], {
			project: {id: 'proj-a', name: 'Project A', projectPath: null},
			memories: [],
		});
		queryClient.setQueryData(['projects', 'proj-a', 'memories', 'MEMORY.md'], {
			markdown: 'old',
			mtime: null,
			projectName: 'Project A',
		});
		queryClient.setQueryData(['projects', 'proj-b', 'memories', 'OTHER.md'], {
			markdown: 'keep',
			mtime: null,
			projectName: 'Project B',
		});

		applyMemoryRemoved(queryClient, 'proj-a', 'MEMORY.md');

		const listState = queryClient.getQueryState(['projects', 'proj-a', 'memories']);
		expect(listState?.isInvalidated).toBe(true);
		expect(queryClient.getQueryData(['projects', 'proj-a', 'memories', 'MEMORY.md'])).toBeUndefined();
		expect(queryClient.getQueryData(['projects', 'proj-b', 'memories', 'OTHER.md'])).toStrictEqual({
			markdown: 'keep',
			mtime: null,
			projectName: 'Project B',
		});
	});

	it('is a no-op when the memories query has never been populated', () => {
		const queryClient = new QueryClient();
		applyMemoryRemoved(queryClient, 'proj-a', 'MEMORY.md');
		expect(queryClient.getQueryData(['projects', 'proj-a', 'memories'])).toBeUndefined();
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

// -----------------------------------------------------------------------
// applySessionLinesAppended
// -----------------------------------------------------------------------

function makeTranscriptCache(overrides?: Partial<TranscriptData>): TranscriptData {
	return {
		records: [],
		byteOffset: 0,
		...overrides,
	};
}

describe('applySessionLinesAppended', () => {
	it('ignores event when no cached data exists for the session', () => {
		const queryClient = new QueryClient();
		applySessionLinesAppended(queryClient, 'sess-1', {
			sessionId: 'sess-1',
			lines: [
				{type: 'assistant', uuid: 'a-1', message: {role: 'assistant', content: [{type: 'text', text: 'hi'}]}},
			],
		});
		expect(queryClient.getQueryData(['sessions', 'sess-1', 'transcript'])).toBeUndefined();
	});

	it('appends new raw records to cached transcript data', () => {
		const queryClient = new QueryClient();
		const existingRecord = {type: 'user', uuid: 'u-1', message: {role: 'user', content: 'hello'}};
		queryClient.setQueryData(
			['sessions', 'sess-1', 'transcript'],
			makeTranscriptCache({records: [existingRecord], byteOffset: 100}),
		);

		const newRecord = {
			type: 'assistant',
			uuid: 'a-1',
			timestamp: '1999-12-31T00:00:00Z',
			message: {role: 'assistant', content: [{type: 'text', text: 'response'}]},
		};
		applySessionLinesAppended(queryClient, 'sess-1', {
			sessionId: 'sess-1',
			lines: [newRecord],
		});

		const cached = queryClient.getQueryData<TranscriptData>(['sessions', 'sess-1', 'transcript'])!;
		expect(cached.records).toStrictEqual([existingRecord, newRecord]);
		expect(cached.byteOffset).toBe(100);
	});

	it('does not modify cache when lines array is empty', () => {
		const queryClient = new QueryClient();
		const original = makeTranscriptCache({byteOffset: 50});
		queryClient.setQueryData(['sessions', 'sess-1', 'transcript'], original);

		applySessionLinesAppended(queryClient, 'sess-1', {
			sessionId: 'sess-1',
			lines: [],
		});

		const cached = queryClient.getQueryData<TranscriptData>(['sessions', 'sess-1', 'transcript'])!;
		expect(cached).toBe(original);
	});

	it('appends all record types including non-user/assistant', () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData(['sessions', 'sess-1', 'transcript'], makeTranscriptCache({byteOffset: 50}));

		const records = [
			{type: 'progress', uuid: 'p-1'},
			{type: 'assistant', uuid: 'a-1', message: {role: 'assistant', content: 'hi'}},
		];
		applySessionLinesAppended(queryClient, 'sess-1', {
			sessionId: 'sess-1',
			lines: records,
		});

		const cached = queryClient.getQueryData<TranscriptData>(['sessions', 'sess-1', 'transcript'])!;
		expect(cached.records).toStrictEqual(records);
	});
});
