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
		mtime: new Date('1999-12-31T00:00:00.000Z'),
		created: new Date('1999-12-30T00:00:00.000Z'),
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
		const payload = toSessionSummaryPayload(makeSession(), false);

		expect(payload).toStrictEqual({
			id: 'sess-1',
			title: 'Hello',
			summary: undefined,
			mtime: '1999-12-31T00:00:00.000Z',
			created: '1999-12-30T00:00:00.000Z',
			project: 'project-1',
			projectName: 'Project 1',
			messageCount: 3,
			gitBranch: undefined,
			starred: false,
		});
	});

	it('reflects the starred flag from the caller', () => {
		const payload = toSessionSummaryPayload(makeSession(), true);
		expect(payload.starred).toBe(true);
	});
});

describe('sessionSummariesEqual', () => {
	it('returns true for identical summaries', () => {
		const a = toSessionSummaryPayload(makeSession(), false);
		const b = toSessionSummaryPayload(makeSession(), false);
		expect(sessionSummariesEqual(a, b)).toBe(true);
	});

	it('returns false when the title changes', () => {
		const a = toSessionSummaryPayload(makeSession(), false);
		const b = toSessionSummaryPayload(makeSession({title: 'Different'}), false);
		expect(sessionSummariesEqual(a, b)).toBe(false);
	});

	it('returns false when the mtime changes', () => {
		const a = toSessionSummaryPayload(makeSession(), false);
		const b = toSessionSummaryPayload(makeSession({mtime: new Date('2000-01-01T00:00:00.000Z')}), false);
		expect(sessionSummariesEqual(a, b)).toBe(false);
	});

	it('returns false when messageCount changes (new message appended)', () => {
		const a = toSessionSummaryPayload(makeSession(), false);
		const b = toSessionSummaryPayload(makeSession({messageCount: 4}), false);
		expect(sessionSummariesEqual(a, b)).toBe(false);
	});

	it('returns false when starred changes', () => {
		const a = toSessionSummaryPayload(makeSession(), false);
		const b = toSessionSummaryPayload(makeSession(), true);
		expect(sessionSummariesEqual(a, b)).toBe(false);
	});
});

describe('toTaskSummaryPayload', () => {
	it('maps blocks/blockedBy arrays through unchanged', () => {
		const row = makeTask({blocks: ['task-2'], blockedBy: ['task-3']});

		const payload = toTaskSummaryPayload(row);

		expect(payload).toStrictEqual({
			taskId: 'task-1',
			projectDir: 'proj',
			subject: 'Do a thing',
			description: 'Details',
			status: 'pending',
			activeForm: null,
			blocks: ['task-2'],
			blockedBy: ['task-3'],
		});
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
