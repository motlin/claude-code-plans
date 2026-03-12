import {writeFileSync, mkdirSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openTestDb, type AppDb} from '../src/lib/db/connection';
import {fullScan, indexJsonlFile, indexSessionsIndex} from '../src/lib/db/indexer';
import {
	listProjectsFromDb,
	listSessionsFromDb,
	listSessionsForProjectFromDb,
	getPlanLinksFromDb,
	getProjectDetailFromDb,
	searchSessionsFromDb,
	getSubagentsForSession,
} from '../src/lib/db/queries';
import * as schema from '../src/lib/db/schema';
import {eq} from 'drizzle-orm';

const testDir = join(tmpdir(), 'claude-db-test-' + process.pid);
let db: AppDb;

function jsonl(...lines: Record<string, unknown>[]): string {
	return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}

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

describe('connection', () => {
	it('creates in-memory databases with schema', () => {
		const row = db.index.select().from(schema.metadata).where(eq(schema.metadata.key, 'schema_version')).get();
		expect(row).toBeDefined();
		expect(row!.value).toBe(schema.SCHEMA_VERSION);
	});
});

describe('indexer', () => {
	it('indexes sessions-index.json', async () => {
		const projectDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projectDir, {recursive: true});
		writeFileSync(
			join(projectDir, 'sessions-index.json'),
			makeSessionsIndex([
				{
					sessionId: 'abc-123',
					fullPath: join(projectDir, 'abc-123.jsonl'),
					fileMtime: Date.now(),
					firstPrompt: 'Fix the login bug',
					summary: 'Fixed auth issue',
					messageCount: 5,
					projectPath: '/Users/craig/projects/app',
				},
				{
					sessionId: 'def-456',
					fullPath: join(projectDir, 'def-456.jsonl'),
					fileMtime: Date.now() - 60000,
					firstPrompt: 'Add tests',
					messageCount: 3,
				},
			]),
		);

		await indexSessionsIndex(db.index, projectDir, '-Users-craig-projects-app');

		const projects = db.index.select().from(schema.projects).all();
		expect(projects).toHaveLength(1);
		expect(projects[0]!.name).toBe('app');

		const sessions = db.index.select().from(schema.sessions).all();
		expect(sessions).toHaveLength(2);

		const abc = sessions.find((s) => s.id === 'abc-123');
		expect(abc).toBeDefined();
		expect(abc!.title).toBe('Fixed auth issue');
		expect(abc!.messageCount).toBe(5);
	});

	it('skips unchanged files based on mtime', async () => {
		const projectDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projectDir, {recursive: true});
		writeFileSync(
			join(projectDir, 'sessions-index.json'),
			makeSessionsIndex([
				{
					sessionId: 'abc-123',
					fullPath: join(projectDir, 'abc-123.jsonl'),
					fileMtime: Date.now(),
					firstPrompt: 'Hello',
				},
			]),
		);

		await indexSessionsIndex(db.index, projectDir, '-Users-craig-projects-app');
		const firstRun = db.index.select().from(schema.indexedFiles).all();
		expect(firstRun).toHaveLength(1);
		const firstIndexedAt = firstRun[0]!.indexedAt;

		// Re-index without changing the file
		await indexSessionsIndex(db.index, projectDir, '-Users-craig-projects-app');
		const secondRun = db.index.select().from(schema.indexedFiles).all();
		expect(secondRun[0]!.indexedAt).toBe(firstIndexedAt);
	});

	it('extracts plan links from file-history-snapshot', async () => {
		const projectDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projectDir, {recursive: true});

		// Create session in DB first (so plan links have a session to reference)
		writeFileSync(
			join(projectDir, 'sessions-index.json'),
			makeSessionsIndex([
				{
					sessionId: 'sess-1',
					fullPath: join(projectDir, 'sess-1.jsonl'),
					fileMtime: Date.now(),
					firstPrompt: 'Work on feature',
				},
			]),
		);
		await indexSessionsIndex(db.index, projectDir, '-Users-craig-projects-app');

		writeFileSync(
			join(projectDir, 'sess-1.jsonl'),
			jsonl(
				{type: 'user', message: {role: 'user', content: 'Work on feature'}},
				{
					type: 'file-history-snapshot',
					snapshot: {
						trackedFileBackups: {
							'/Users/craig/.claude/plans/my-plan.md': 'backup-content',
						},
					},
				},
			),
		);

		await indexJsonlFile(db.index, join(projectDir, 'sess-1.jsonl'), '-Users-craig-projects-app');

		const links = db.index.select().from(schema.planSessions).all();
		expect(links).toHaveLength(1);
		expect(links[0]!.planFilename).toBe('my-plan.md');
		expect(links[0]!.sessionId).toBe('sess-1');
	});

	it('extracts custom-title from JSONL', async () => {
		const projectDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projectDir, {recursive: true});

		writeFileSync(
			join(projectDir, 'sessions-index.json'),
			makeSessionsIndex([
				{
					sessionId: 'titled-sess',
					fullPath: join(projectDir, 'titled-sess.jsonl'),
					fileMtime: Date.now(),
					firstPrompt: 'Do something',
				},
			]),
		);
		await indexSessionsIndex(db.index, projectDir, '-Users-craig-projects-app');

		writeFileSync(
			join(projectDir, 'titled-sess.jsonl'),
			jsonl(
				{type: 'user', message: {role: 'user', content: 'Do something'}},
				{type: 'custom-title', customTitle: 'My Custom Title', sessionId: 'titled-sess'},
			),
		);

		await indexJsonlFile(db.index, join(projectDir, 'titled-sess.jsonl'), '-Users-craig-projects-app');

		const session = db.index.select().from(schema.sessions).where(eq(schema.sessions.id, 'titled-sess')).get();
		expect(session).toBeDefined();
		expect(session!.customTitle).toBe('My Custom Title');
		expect(session!.title).toBe('My Custom Title');
	});

	it('creates session from JSONL when not in index', async () => {
		const projectDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projectDir, {recursive: true});

		writeFileSync(
			join(projectDir, 'orphan-sess.jsonl'),
			jsonl({type: 'user', message: {role: 'user', content: 'Hello world'}}),
		);

		await indexJsonlFile(db.index, join(projectDir, 'orphan-sess.jsonl'), '-Users-craig-projects-app');

		const session = db.index.select().from(schema.sessions).where(eq(schema.sessions.id, 'orphan-sess')).get();
		expect(session).toBeDefined();
		expect(session!.title).toBe('Hello world');
		expect(session!.firstPrompt).toBe('Hello world');
	});

	it('fullScan indexes a complete project directory', async () => {
		const projectDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projectDir, {recursive: true});

		writeFileSync(
			join(projectDir, 'sessions-index.json'),
			makeSessionsIndex([
				{
					sessionId: 'sess-a',
					fullPath: join(projectDir, 'sess-a.jsonl'),
					fileMtime: Date.now(),
					firstPrompt: 'First session',
					messageCount: 10,
				},
			]),
		);

		writeFileSync(
			join(projectDir, 'sess-a.jsonl'),
			jsonl({type: 'user', message: {role: 'user', content: 'First session'}}),
		);

		writeFileSync(
			join(projectDir, 'sess-b.jsonl'),
			jsonl({type: 'user', message: {role: 'user', content: 'Second session'}}),
		);

		await fullScan(db.index, testDir);

		const projects = listProjectsFromDb(db.index);
		expect(projects).toHaveLength(1);
		expect(projects[0]!.name).toBe('app');

		const sessions = db.index.select().from(schema.sessions).all();
		expect(sessions).toHaveLength(2);
	});
});

describe('queries', () => {
	beforeEach(() => {
		// Seed test data directly
		db.index
			.insert(schema.projects)
			.values([
				{id: 'proj-a', name: 'Alpha', projectPath: '/projects/alpha', updatedAt: 2000},
				{id: 'proj-b', name: 'Beta', projectPath: '/projects/beta', updatedAt: 1000},
			])
			.run();

		db.index
			.insert(schema.sessions)
			.values([
				{
					id: 'sess-1',
					projectId: 'proj-a',
					title: 'Fix login',
					firstPrompt: 'Fix the login bug',
					summary: 'Fixed auth',
					messageCount: 5,
					isSidechain: 0,
					createdAt: 1000,
					mtimeMs: 3000,
					filePath: '/path/sess-1.jsonl',
				},
				{
					id: 'sess-2',
					projectId: 'proj-a',
					title: 'Add tests',
					firstPrompt: 'Add unit tests',
					messageCount: 3,
					isSidechain: 0,
					createdAt: 500,
					mtimeMs: 2000,
					filePath: '/path/sess-2.jsonl',
				},
				{
					id: 'sess-3',
					projectId: 'proj-b',
					title: 'Deploy',
					firstPrompt: 'Deploy to prod',
					messageCount: 2,
					isSidechain: 0,
					createdAt: 800,
					mtimeMs: 1500,
					filePath: '/path/sess-3.jsonl',
				},
				{
					id: 'sess-side',
					projectId: 'proj-a',
					title: 'Sidechain',
					messageCount: 1,
					isSidechain: 1,
					createdAt: 900,
					mtimeMs: 2500,
					filePath: '/path/sess-side.jsonl',
				},
			])
			.run();

		db.index
			.insert(schema.planSessions)
			.values([
				{planFilename: 'plan-a.md', sessionId: 'sess-1', projectId: 'proj-a'},
				{planFilename: 'plan-a.md', sessionId: 'sess-2', projectId: 'proj-a'},
			])
			.run();
	});

	it('listProjectsFromDb returns projects sorted by last activity', () => {
		const projects = listProjectsFromDb(db.index);
		expect(projects).toHaveLength(2);
		expect(projects[0]!.id).toBe('proj-a');
		expect(projects[0]!.sessionCount).toBe(2); // excludes sidechain
		expect(projects[1]!.id).toBe('proj-b');
	});

	it('listSessionsFromDb returns grouped sessions excluding sidechains', () => {
		const groups = listSessionsFromDb(db.index);
		expect(groups).toHaveLength(2);
		expect(groups[0]!.project).toBe('proj-a');
		expect(groups[0]!.sessions).toHaveLength(2); // no sidechain
		expect(groups[0]!.sessions[0]!.id).toBe('sess-1'); // highest mtime first
	});

	it('listSessionsForProjectFromDb returns sessions for a project', () => {
		const sessions = listSessionsForProjectFromDb(db.index, 'proj-a');
		expect(sessions).toHaveLength(2);
		expect(sessions[0]!.id).toBe('sess-1');
		expect(sessions[1]!.id).toBe('sess-2');
	});

	it('getPlanLinksFromDb returns links for a plan with session titles', () => {
		const links = getPlanLinksFromDb(db.index, 'plan-a.md');
		expect(links).toHaveLength(2);
		expect(links[0]!.projectName).toBe('Alpha');
		expect(links[0]!.sessionTitle).toBe('Fix login');
		expect(links[1]!.sessionTitle).toBe('Add tests');
	});

	it('getPlanLinksFromDb returns all links when no filename given', () => {
		const links = getPlanLinksFromDb(db.index);
		expect(links).toHaveLength(2);
	});

	it('getProjectDetailFromDb returns project with sessions and plan links', () => {
		const detail = getProjectDetailFromDb(db.index, 'proj-a');
		expect(detail).not.toBeNull();
		expect(detail!.name).toBe('Alpha');
		expect(detail!.sessions).toHaveLength(2);
		expect(detail!.planLinks).toHaveLength(2);
	});

	it('getProjectDetailFromDb returns null for non-existent project', () => {
		expect(getProjectDetailFromDb(db.index, 'nonexistent')).toBeNull();
	});

	it('searchSessionsFromDb finds sessions by title', () => {
		const results = searchSessionsFromDb(db.index, 'login');
		expect(results.length).toBeGreaterThan(0);
		expect(results[0]!.sessionId).toBe('sess-1');
	});

	it('searchSessionsFromDb finds sessions by first prompt', () => {
		const results = searchSessionsFromDb(db.index, 'unit tests');
		expect(results.length).toBeGreaterThan(0);
		expect(results[0]!.sessionId).toBe('sess-2');
	});
});

describe('subagents', () => {
	it('getSubagentsForSession returns subagents', () => {
		db.index.insert(schema.projects).values({id: 'proj-x', name: 'X', updatedAt: 1000}).run();
		db.index
			.insert(schema.subagents)
			.values([
				{
					id: 'agent-abc',
					sessionId: 'sess-x',
					projectId: 'proj-x',
					agentType: 'Explore',
					slug: 'explore files',
					filePath: '/path/agent-abc.jsonl',
					mtimeMs: 1000,
				},
				{
					id: 'agent-def',
					sessionId: 'sess-x',
					projectId: 'proj-x',
					agentType: null,
					slug: null,
					filePath: '/path/agent-def.jsonl',
					mtimeMs: 2000,
				},
			])
			.run();

		const agents = getSubagentsForSession(db.index, 'sess-x');
		expect(agents).toHaveLength(2);
		expect(agents[0]!.agentType).toBe('Explore');
	});

	it('returns empty array for session with no subagents', () => {
		expect(getSubagentsForSession(db.index, 'nonexistent')).toEqual([]);
	});
});
