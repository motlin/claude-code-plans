import {describe, expect, it} from 'vitest';
import {__testing} from '../src/lib/watcher';
import type {SessionEntry} from '../src/lib/sessions';
import type {TaskRow} from '../src/lib/db/queries';

const {toSessionSummaryPayload, sessionSummariesEqual, toTaskSummaryPayload, tasksEqual} = __testing;

function makeSession(overrides: Partial<SessionEntry> = {}): SessionEntry {
	return {
		id: 'sess-1',
		title: 'Hello',
		firstPrompt: undefined,
		summary: undefined,
		customTitle: undefined,
		mtime: new Date('2026-04-18T00:00:00.000Z'),
		created: new Date('2026-04-17T00:00:00.000Z'),
		project: 'project-1',
		projectName: 'Project 1',
		messageCount: 3,
		gitBranch: undefined,
		isSidechain: false,
		...overrides,
	};
}

function makeTask(overrides: Partial<TaskRow> = {}): TaskRow {
	return {
		taskId: 'task-1',
		projectDir: 'proj',
		subject: 'Do a thing',
		description: 'Details',
		status: 'pending',
		activeForm: null,
		blocks: [],
		blockedBy: [],
		...overrides,
	};
}

describe('toSessionSummaryPayload', () => {
	it('serializes dates as ISO strings and preserves core fields', () => {
		const payload = toSessionSummaryPayload(makeSession());

		expect(payload).toStrictEqual({
			id: 'sess-1',
			title: 'Hello',
			summary: undefined,
			mtime: '2026-04-18T00:00:00.000Z',
			created: '2026-04-17T00:00:00.000Z',
			project: 'project-1',
			projectName: 'Project 1',
			messageCount: 3,
			gitBranch: undefined,
		});
	});
});

describe('sessionSummariesEqual', () => {
	it('returns true for identical summaries', () => {
		const a = toSessionSummaryPayload(makeSession());
		const b = toSessionSummaryPayload(makeSession());
		expect(sessionSummariesEqual(a, b)).toBe(true);
	});

	it('returns false when the title changes', () => {
		const a = toSessionSummaryPayload(makeSession());
		const b = toSessionSummaryPayload(makeSession({title: 'Different'}));
		expect(sessionSummariesEqual(a, b)).toBe(false);
	});

	it('returns false when the mtime changes', () => {
		const a = toSessionSummaryPayload(makeSession());
		const b = toSessionSummaryPayload(makeSession({mtime: new Date('2026-04-19T00:00:00.000Z')}));
		expect(sessionSummariesEqual(a, b)).toBe(false);
	});

	it('returns false when messageCount changes (new message appended)', () => {
		const a = toSessionSummaryPayload(makeSession());
		const b = toSessionSummaryPayload(makeSession({messageCount: 4}));
		expect(sessionSummariesEqual(a, b)).toBe(false);
	});
});

describe('toTaskSummaryPayload', () => {
	it('maps blocks/blockedBy arrays through unchanged', () => {
		const row = makeTask({blocks: ['task-2'], blockedBy: ['task-3']});

		const payload = toTaskSummaryPayload(row);

		expect(payload.blocks).toStrictEqual(['task-2']);
		expect(payload.blockedBy).toStrictEqual(['task-3']);
		expect(payload.taskId).toBe('task-1');
		expect(payload.status).toBe('pending');
	});
});

describe('tasksEqual', () => {
	it('returns true for identical tasks', () => {
		const a = toTaskSummaryPayload(makeTask());
		const b = toTaskSummaryPayload(makeTask());
		expect(tasksEqual(a, b)).toBe(true);
	});

	it('returns false when status changes from pending to completed', () => {
		const a = toTaskSummaryPayload(makeTask({status: 'pending'}));
		const b = toTaskSummaryPayload(makeTask({status: 'completed'}));
		expect(tasksEqual(a, b)).toBe(false);
	});

	it('returns false when blocks array changes order', () => {
		const a = toTaskSummaryPayload(makeTask({blocks: ['a', 'b']}));
		const b = toTaskSummaryPayload(makeTask({blocks: ['b', 'a']}));
		expect(tasksEqual(a, b)).toBe(false);
	});
});
