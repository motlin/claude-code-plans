import {writeFileSync, mkdirSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openTestDb, type AppDb} from '../src/lib/db/connection';
import {indexSessionsIndex} from '../src/lib/db/indexer';
import {buildSessionSummaryPayloadFromDb, toActiveSessionPayload} from '../src/lib/session-summary';
import type {ActiveSessionEntry} from '../src/lib/active-session-store';

const testDir = join(tmpdir(), 'claude-session-summary-test-' + process.pid);
let db: AppDb;

function makeSessionsIndex(entries: Record<string, unknown>[]): string {
	return JSON.stringify({version: 1, entries});
}

beforeEach(() => {
	mkdirSync(testDir, {recursive: true});
	db = openTestDb();
});

afterEach(() => {
	db.close();
	rmSync(testDir, {recursive: true, force: true});
});

describe('toActiveSessionPayload', () => {
	it('maps an ActiveSessionEntry into an ActiveSessionPayload 1:1', () => {
		const entry: ActiveSessionEntry = {
			sessionId: 'abc-123',
			cwd: '/home/user/project',
			model: 'claude-sonnet-4-6',
			startedAt: 1_700_000_000_000,
			lastActivity: 1_700_000_001_000,
		};

		const payload = toActiveSessionPayload(entry);

		expect(payload).toStrictEqual({
			sessionId: 'abc-123',
			cwd: '/home/user/project',
			model: 'claude-sonnet-4-6',
			startedAt: 1_700_000_000_000,
			lastActivity: 1_700_000_001_000,
		});
	});
});

describe('buildSessionSummaryPayloadFromDb', () => {
	it('returns a SessionSummaryPayload for a known session id', async () => {
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
					summary: 'Fixed auth issue',
					messageCount: 5,
					projectPath: '/Users/craig/projects/app',
				},
			]),
		);
		await indexSessionsIndex(db.index, projectDir, '-Users-craig-projects-app');

		const payload = buildSessionSummaryPayloadFromDb(db.index, 'abc-123');

		expect(payload).not.toBeNull();
		expect(payload!.id).toBe('abc-123');
		expect(payload!.title).toBe('Fixed auth issue');
		expect(payload!.messageCount).toBe(5);
		expect(payload!.project).toBe('-Users-craig-projects-app');
		expect(payload!.projectName).toBe('app');
		// Dates serialized as ISO strings so payloads survive JSON.stringify
		expect(typeof payload!.mtime).toBe('string');
		expect(typeof payload!.created).toBe('string');
	});

	it('returns null when the session id is not in the db', () => {
		const payload = buildSessionSummaryPayloadFromDb(db.index, 'does-not-exist');

		expect(payload).toBeNull();
	});
});
