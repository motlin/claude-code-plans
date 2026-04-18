import {writeFileSync, mkdirSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openTestDb, type AppDb} from '../src/lib/db/connection';
import {indexSessionsIndex} from '../src/lib/db/indexer';
import {dispatchHookEvent} from '../src/lib/hook-dispatcher';
import {DOMAIN_EVENTS, SSE_EVENTS} from '../src/lib/hook-events';
import type {HookEvent} from '../src/lib/hook-events';

const testDir = join(tmpdir(), 'claude-hook-dispatcher-test-' + process.pid);
let db: AppDb;

type Broadcast = {type: string; data: Record<string, unknown>};

function makeSessionsIndex(entries: Record<string, unknown>[]): string {
	return JSON.stringify({version: 1, entries});
}

function makeStore() {
	const activeCalls: Array<{sessionId: string; meta: {cwd: string; model?: string}}> = [];
	const endedCalls: string[] = [];
	const touchedCalls: string[] = [];
	return {
		activeCalls,
		endedCalls,
		touchedCalls,
		store: {
			markSessionActive: (sessionId: string, meta: {cwd: string; model?: string}) => {
				activeCalls.push({sessionId, meta});
			},
			markSessionEnded: (sessionId: string) => {
				endedCalls.push(sessionId);
			},
			touchSession: (sessionId: string) => {
				touchedCalls.push(sessionId);
			},
			getActiveSessionEntry: (sessionId: string) => {
				const call = activeCalls.find((c) => c.sessionId === sessionId);
				if (!call) return null;
				return {
					sessionId,
					cwd: call.meta.cwd,
					model: call.meta.model ?? '',
					startedAt: 1_700_000_000_000,
					lastActivity: 1_700_000_000_000,
				};
			},
		},
	};
}

beforeEach(() => {
	mkdirSync(testDir, {recursive: true});
	db = openTestDb();
});

afterEach(() => {
	db.close();
	rmSync(testDir, {recursive: true, force: true});
});

describe('dispatchHookEvent', () => {
	it('SessionStart broadcasts both legacy SESSION_START and domain SESSION_STARTED with full payload', () => {
		const broadcasts: Broadcast[] = [];
		const {store, activeCalls} = makeStore();
		const event: HookEvent = {
			hook_event_name: 'SessionStart',
			session_id: 'abc-123',
			cwd: '/home/user/project',
			model: 'claude-sonnet-4-6',
		};

		dispatchHookEvent({
			event,
			db: db.index,
			store,
			broadcast: (type, data) => broadcasts.push({type, data}),
		});

		expect(activeCalls).toEqual([
			{sessionId: 'abc-123', meta: {cwd: '/home/user/project', model: 'claude-sonnet-4-6'}},
		]);
		const legacy = broadcasts.find((b) => b.type === SSE_EVENTS.SESSION_START);
		expect(legacy).toBeDefined();
		expect(legacy!.data).toEqual({
			sessionId: 'abc-123',
			cwd: '/home/user/project',
			model: 'claude-sonnet-4-6',
		});
		const domain = broadcasts.find((b) => b.type === DOMAIN_EVENTS.SESSION_STARTED);
		expect(domain).toBeDefined();
		expect(domain!.data).toMatchObject({
			session: {
				sessionId: 'abc-123',
				cwd: '/home/user/project',
				model: 'claude-sonnet-4-6',
			},
		});
	});

	it('SessionStart also emits session:added when the session is indexed in the db', async () => {
		const projectDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projectDir, {recursive: true});
		writeFileSync(
			join(projectDir, 'sessions-index.json'),
			makeSessionsIndex([
				{
					sessionId: 'abc-123',
					fullPath: join(projectDir, 'abc-123.jsonl'),
					fileMtime: 1_700_000_000_000,
					firstPrompt: 'Fix the login bug',
					messageCount: 1,
					projectPath: '/Users/craig/projects/app',
				},
			]),
		);
		await indexSessionsIndex(db.index, projectDir, '-Users-craig-projects-app');

		const broadcasts: Broadcast[] = [];
		const {store} = makeStore();
		dispatchHookEvent({
			event: {
				hook_event_name: 'SessionStart',
				session_id: 'abc-123',
				cwd: '/Users/craig/projects/app',
			},
			db: db.index,
			store,
			broadcast: (type, data) => broadcasts.push({type, data}),
		});

		const added = broadcasts.find((b) => b.type === DOMAIN_EVENTS.SESSION_ADDED);
		expect(added).toBeDefined();
		expect(added!.data).toMatchObject({session: {id: 'abc-123', messageCount: 1}});
	});

	it('Stop broadcasts both legacy SESSION_UPDATE and domain SESSION_UPDATED with enriched payload', async () => {
		const projectDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projectDir, {recursive: true});
		writeFileSync(
			join(projectDir, 'sessions-index.json'),
			makeSessionsIndex([
				{
					sessionId: 'abc-123',
					fullPath: join(projectDir, 'abc-123.jsonl'),
					fileMtime: 1_700_000_000_000,
					firstPrompt: 'Ship feature X',
					summary: 'Shipped feature X',
					messageCount: 12,
					projectPath: '/Users/craig/projects/app',
				},
			]),
		);
		await indexSessionsIndex(db.index, projectDir, '-Users-craig-projects-app');

		const broadcasts: Broadcast[] = [];
		const {store, touchedCalls} = makeStore();
		dispatchHookEvent({
			event: {hook_event_name: 'Stop', session_id: 'abc-123'},
			db: db.index,
			store,
			broadcast: (type, data) => broadcasts.push({type, data}),
		});

		expect(touchedCalls).toEqual(['abc-123']);
		const legacy = broadcasts.find((b) => b.type === SSE_EVENTS.SESSION_UPDATE);
		expect(legacy).toBeDefined();
		expect(legacy!.data).toEqual({sessionId: 'abc-123'});
		const domain = broadcasts.find((b) => b.type === DOMAIN_EVENTS.SESSION_UPDATED);
		expect(domain).toBeDefined();
		expect(domain!.data).toMatchObject({
			session: {
				id: 'abc-123',
				title: 'Shipped feature X',
				messageCount: 12,
				projectName: 'app',
			},
		});
	});

	it('Stop without an indexed session emits only the legacy event', () => {
		const broadcasts: Broadcast[] = [];
		const {store} = makeStore();
		dispatchHookEvent({
			event: {hook_event_name: 'Stop', session_id: 'unknown-session'},
			db: db.index,
			store,
			broadcast: (type, data) => broadcasts.push({type, data}),
		});

		expect(broadcasts.some((b) => b.type === SSE_EVENTS.SESSION_UPDATE)).toBe(true);
		expect(broadcasts.some((b) => b.type === DOMAIN_EVENTS.SESSION_UPDATED)).toBe(false);
	});

	it('SessionEnd broadcasts both legacy SESSION_END and domain SESSION_ENDED', () => {
		const broadcasts: Broadcast[] = [];
		const {store, endedCalls} = makeStore();
		dispatchHookEvent({
			event: {hook_event_name: 'SessionEnd', session_id: 'abc-123'},
			db: db.index,
			store,
			broadcast: (type, data) => broadcasts.push({type, data}),
		});

		expect(endedCalls).toEqual(['abc-123']);
		expect(broadcasts.find((b) => b.type === SSE_EVENTS.SESSION_END)!.data).toEqual({sessionId: 'abc-123'});
		expect(broadcasts.find((b) => b.type === DOMAIN_EVENTS.SESSION_ENDED)!.data).toEqual({sessionId: 'abc-123'});
	});

	it('TaskCompleted broadcasts legacy TASK_COMPLETED and domain TASK_COMPLETED with the same payload', () => {
		const broadcasts: Broadcast[] = [];
		const {store, touchedCalls} = makeStore();
		dispatchHookEvent({
			event: {
				hook_event_name: 'TaskCompleted',
				session_id: 'abc-123',
				task_id: 'task-001',
				task_subject: 'Build auth',
			},
			db: db.index,
			store,
			broadcast: (type, data) => broadcasts.push({type, data}),
		});

		expect(touchedCalls).toEqual(['abc-123']);
		// Both names happen to be 'task:completed' because the legacy + domain names collide
		const completed = broadcasts.filter((b) => b.type === SSE_EVENTS.TASK_COMPLETED);
		expect(completed.length).toBeGreaterThan(0);
		expect(completed[0]!.data).toMatchObject({taskId: 'task-001', subject: 'Build auth'});
	});
});
