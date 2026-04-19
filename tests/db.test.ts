import {writeFileSync, mkdirSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openTestDb, type AppDb} from '../src/lib/db/connection';
import {
	fullScan,
	indexJsonlFile,
	indexSessionsIndex,
	indexTaskFile,
	pruneStalePlanLinks,
	indexSubagentFile,
	linkSubagentParents,
	scanTasksDir,
} from '../src/lib/db/indexer';
import {
	listProjectsFromDb,
	listSessionsFromDb,
	listSessionsForProjectFromDb,
	getPlanLinksFromDb,
	getProjectDetailFromDb,
	searchSessionsFromDb,
	getSubagentsForSession,
	getSubagentsForProject,
	getPlanProjectMappings,
	getSessionProjectPath,
	isSessionStarred,
	toggleStar,
	getStarredSessionIds,
	getStarredSessions,
	searchMessageContent,
	getTasksForProject,
	getIncompleteTasksGroupedByProject,
	getTaskCountsForProject,
	buildSubagentTree,
	listBranchesForProject,
	listSessionsForBranch,
	listCwdsForProject,
	type DbSubagent,
	type ParallelGroup,
	type SubagentTreeNode,
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

	it('extracts plan links from plan_mode attachments (before file is edited)', async () => {
		// A session that enters plan mode emits an `attachment` record with
		// `attachment.type === "plan_mode"` and a `planFilePath`. This fires
		// *before* the plan file is ever edited, so it links the session even
		// when no file-history-snapshot trackedFileBackups entry exists.
		const projectDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projectDir, {recursive: true});

		writeFileSync(
			join(projectDir, 'sessions-index.json'),
			makeSessionsIndex([
				{
					sessionId: 'sess-plan-mode',
					fullPath: join(projectDir, 'sess-plan-mode.jsonl'),
					fileMtime: Date.now(),
					firstPrompt: 'Draft a plan',
				},
			]),
		);
		await indexSessionsIndex(db.index, projectDir, '-Users-craig-projects-app');

		writeFileSync(
			join(projectDir, 'sess-plan-mode.jsonl'),
			jsonl(
				{type: 'user', message: {role: 'user', content: 'Draft a plan'}},
				{
					type: 'attachment',
					attachment: {
						type: 'plan_mode',
						reminderType: 'full',
						isSubAgent: false,
						planFilePath: '/Users/craig/.claude/plans/abstract-knitting-garden.md',
						planExists: false,
					},
				},
			),
		);

		await indexJsonlFile(db.index, join(projectDir, 'sess-plan-mode.jsonl'), '-Users-craig-projects-app');

		const links = db.index.select().from(schema.planSessions).all();
		expect(links).toHaveLength(1);
		expect(links[0]!.planFilename).toBe('abstract-knitting-garden.md');
		expect(links[0]!.sessionId).toBe('sess-plan-mode');
		expect(links[0]!.projectId).toBe('-Users-craig-projects-app');
	});

	it('deduplicates plan links when both plan_mode and file-history-snapshot point to the same plan', async () => {
		const projectDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projectDir, {recursive: true});

		writeFileSync(
			join(projectDir, 'sessions-index.json'),
			makeSessionsIndex([
				{
					sessionId: 'sess-dup',
					fullPath: join(projectDir, 'sess-dup.jsonl'),
					fileMtime: Date.now(),
					firstPrompt: 'Draft',
				},
			]),
		);
		await indexSessionsIndex(db.index, projectDir, '-Users-craig-projects-app');

		writeFileSync(
			join(projectDir, 'sess-dup.jsonl'),
			jsonl(
				{type: 'user', message: {role: 'user', content: 'Draft'}},
				{
					type: 'attachment',
					attachment: {
						type: 'plan_mode',
						planFilePath: '/Users/craig/.claude/plans/dual-plan.md',
					},
				},
				{
					type: 'file-history-snapshot',
					snapshot: {
						trackedFileBackups: {
							'/Users/craig/.claude/plans/dual-plan.md': 'backup',
						},
					},
				},
			),
		);

		await indexJsonlFile(db.index, join(projectDir, 'sess-dup.jsonl'), '-Users-craig-projects-app');

		const links = db.index.select().from(schema.planSessions).all();
		expect(links).toHaveLength(1);
		expect(links[0]!.planFilename).toBe('dual-plan.md');
	});

	it('pruneStalePlanLinks removes plan_sessions rows whose plan file no longer exists', async () => {
		const plansDir = join(testDir, 'plans');
		mkdirSync(plansDir, {recursive: true});
		writeFileSync(join(plansDir, 'still-here.md'), '# Still Here');

		db.index
			.insert(schema.planSessions)
			.values([
				{planFilename: 'still-here.md', sessionId: 's1', projectId: 'p1'},
				{planFilename: 'gone.md', sessionId: 's1', projectId: 'p1'},
				{planFilename: 'also-gone.md', sessionId: 's2', projectId: 'p1'},
			])
			.run();

		const removed = await pruneStalePlanLinks(db.index, plansDir);
		expect(removed).toBe(2);

		const remaining = db.index.select().from(schema.planSessions).all();
		expect(remaining).toHaveLength(1);
		expect(remaining[0]!.planFilename).toBe('still-here.md');
	});

	it('pruneStalePlanLinks keeps all rows when plans directory is missing', async () => {
		db.index
			.insert(schema.planSessions)
			.values({planFilename: 'some-plan.md', sessionId: 's1', projectId: 'p1'})
			.run();

		const removed = await pruneStalePlanLinks(db.index, join(testDir, 'nonexistent-plans-dir'));
		expect(removed).toBe(0);

		const remaining = db.index.select().from(schema.planSessions).all();
		expect(remaining).toHaveLength(1);
	});

	it('ignores plan_mode attachments with no planFilePath', async () => {
		const projectDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projectDir, {recursive: true});

		writeFileSync(
			join(projectDir, 'sessions-index.json'),
			makeSessionsIndex([
				{
					sessionId: 'sess-no-path',
					fullPath: join(projectDir, 'sess-no-path.jsonl'),
					fileMtime: Date.now(),
					firstPrompt: 'Draft',
				},
			]),
		);
		await indexSessionsIndex(db.index, projectDir, '-Users-craig-projects-app');

		writeFileSync(
			join(projectDir, 'sess-no-path.jsonl'),
			jsonl(
				{type: 'user', message: {role: 'user', content: 'Draft'}},
				{
					type: 'attachment',
					attachment: {type: 'plan_mode', reminderType: 'full'},
				},
			),
		);

		await indexJsonlFile(db.index, join(projectDir, 'sess-no-path.jsonl'), '-Users-craig-projects-app');

		const links = db.index.select().from(schema.planSessions).all();
		expect(links).toHaveLength(0);
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

	it('updates session mtime when JSONL is re-indexed', async () => {
		const projectDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projectDir, {recursive: true});

		const oldMtime = Date.now() - 86_400_000; // 1 day ago

		writeFileSync(
			join(projectDir, 'sessions-index.json'),
			makeSessionsIndex([
				{
					sessionId: 'mtime-sess',
					fullPath: join(projectDir, 'mtime-sess.jsonl'),
					fileMtime: oldMtime,
					firstPrompt: 'Old prompt',
					messageCount: 1,
				},
			]),
		);

		await indexSessionsIndex(db.index, projectDir, '-Users-craig-projects-app');

		const before = db.index.select().from(schema.sessions).where(eq(schema.sessions.id, 'mtime-sess')).get();
		expect(before!.mtimeMs).toBe(oldMtime);

		// Write JSONL file — its filesystem mtime will be newer than oldMtime
		const jsonlPath = join(projectDir, 'mtime-sess.jsonl');
		writeFileSync(jsonlPath, jsonl({type: 'user', message: {role: 'user', content: 'New message'}}));

		await indexJsonlFile(db.index, jsonlPath, '-Users-craig-projects-app');

		const after = db.index.select().from(schema.sessions).where(eq(schema.sessions.id, 'mtime-sess')).get();
		expect(after!.mtimeMs).toBeGreaterThan(oldMtime);
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
		expect(projects[0]!.name).toBe('/Users/craig/projects/app');

		const sessions = db.index.select().from(schema.sessions).all();
		expect(sessions).toHaveLength(2);
	});

	it('extracts cwd from JSONL attachment lines', async () => {
		const projectDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projectDir, {recursive: true});

		writeFileSync(
			join(projectDir, 'cwd-sess.jsonl'),
			jsonl(
				{type: 'attachment', cwd: '/Users/craig/projects/app'},
				{type: 'user', message: {role: 'user', content: 'Hello from cwd'}},
			),
		);

		await indexJsonlFile(db.index, join(projectDir, 'cwd-sess.jsonl'), '-Users-craig-projects-app');

		const session = db.index.select().from(schema.sessions).where(eq(schema.sessions.id, 'cwd-sess')).get();
		expect(session).toBeDefined();
		expect(session!.cwd).toBe('/Users/craig/projects/app');
	});

	it('indexes cwd from sessions-index.json projectPath', async () => {
		const projectDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projectDir, {recursive: true});
		writeFileSync(
			join(projectDir, 'sessions-index.json'),
			makeSessionsIndex([
				{
					sessionId: 'idx-cwd-1',
					fullPath: join(projectDir, 'idx-cwd-1.jsonl'),
					fileMtime: Date.now(),
					firstPrompt: 'Hello',
					projectPath: '/Users/craig/projects/app',
				},
			]),
		);

		await indexSessionsIndex(db.index, projectDir, '-Users-craig-projects-app');

		const session = db.index.select().from(schema.sessions).where(eq(schema.sessions.id, 'idx-cwd-1')).get();
		expect(session).toBeDefined();
		expect(session!.cwd).toBe('/Users/craig/projects/app');
	});

	it('updates cwd when re-indexing JSONL for existing session', async () => {
		const projectDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projectDir, {recursive: true});

		// Create session via index first (no cwd)
		writeFileSync(
			join(projectDir, 'sessions-index.json'),
			makeSessionsIndex([
				{
					sessionId: 'update-cwd',
					fullPath: join(projectDir, 'update-cwd.jsonl'),
					fileMtime: Date.now() - 1000,
					firstPrompt: 'Initial',
				},
			]),
		);
		await indexSessionsIndex(db.index, projectDir, '-Users-craig-projects-app');

		const before = db.index.select().from(schema.sessions).where(eq(schema.sessions.id, 'update-cwd')).get();
		expect(before!.cwd).toBeNull();

		// Now write JSONL with cwd
		writeFileSync(
			join(projectDir, 'update-cwd.jsonl'),
			jsonl(
				{type: 'attachment', cwd: '/Users/craig/projects/app-worktree'},
				{type: 'user', message: {role: 'user', content: 'Updated'}},
			),
		);

		await indexJsonlFile(db.index, join(projectDir, 'update-cwd.jsonl'), '-Users-craig-projects-app');

		const after = db.index.select().from(schema.sessions).where(eq(schema.sessions.id, 'update-cwd')).get();
		expect(after!.cwd).toBe('/Users/craig/projects/app-worktree');
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

	it('getPlanProjectMappings returns distinct plan-to-project mappings', () => {
		const mappings = getPlanProjectMappings(db.index);
		expect(mappings).toHaveLength(1); // plan-a.md -> proj-a (deduplicated)
		expect(mappings[0]!.planFilename).toBe('plan-a.md');
		expect(mappings[0]!.projectId).toBe('proj-a');
		expect(mappings[0]!.projectName).toBe('Alpha');
	});

	it('getPlanProjectMappings returns mappings across multiple projects', () => {
		db.index
			.insert(schema.planSessions)
			.values({planFilename: 'plan-b.md', sessionId: 'sess-3', projectId: 'proj-b'})
			.run();

		const mappings = getPlanProjectMappings(db.index);
		expect(mappings).toHaveLength(2);
		const filenames = mappings.map((m) => m.planFilename).sort();
		expect(filenames).toEqual(['plan-a.md', 'plan-b.md']);
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

	it('getSessionProjectPath returns project path for a session', () => {
		const path = getSessionProjectPath(db.index, 'sess-1');
		expect(path).toBe('/projects/alpha');
	});

	it('getSessionProjectPath returns null for non-existent session', () => {
		const path = getSessionProjectPath(db.index, 'nonexistent');
		expect(path).toBeNull();
	});

	it('getSessionProjectPath returns project path for session in different project', () => {
		const path = getSessionProjectPath(db.index, 'sess-3');
		expect(path).toBe('/projects/beta');
	});
});

describe('branch and cwd queries', () => {
	beforeEach(() => {
		db.index
			.insert(schema.projects)
			.values([{id: 'proj-a', name: 'Alpha', projectPath: '/projects/alpha', updatedAt: 2000}])
			.run();

		db.index
			.insert(schema.sessions)
			.values([
				{
					id: 'b-sess-1',
					projectId: 'proj-a',
					title: 'Feature work',
					messageCount: 5,
					gitBranch: 'feature-x',
					cwd: '/projects/alpha',
					isSidechain: 0,
					createdAt: 1000,
					mtimeMs: 3000,
					filePath: '/path/b-sess-1.jsonl',
				},
				{
					id: 'b-sess-2',
					projectId: 'proj-a',
					title: 'More feature work',
					messageCount: 3,
					gitBranch: 'feature-x',
					cwd: '/projects/alpha',
					isSidechain: 0,
					createdAt: 500,
					mtimeMs: 2000,
					filePath: '/path/b-sess-2.jsonl',
				},
				{
					id: 'b-sess-3',
					projectId: 'proj-a',
					title: 'Main work',
					messageCount: 2,
					gitBranch: 'main',
					cwd: '/projects/alpha-worktree',
					isSidechain: 0,
					createdAt: 800,
					mtimeMs: 1500,
					filePath: '/path/b-sess-3.jsonl',
				},
				{
					id: 'b-sess-4',
					projectId: 'proj-a',
					title: 'No branch',
					messageCount: 1,
					isSidechain: 0,
					createdAt: 700,
					mtimeMs: 1000,
					filePath: '/path/b-sess-4.jsonl',
				},
				{
					id: 'b-sess-side',
					projectId: 'proj-a',
					title: 'Sidechain',
					messageCount: 1,
					gitBranch: 'feature-x',
					isSidechain: 1,
					createdAt: 900,
					mtimeMs: 2500,
					filePath: '/path/b-sess-side.jsonl',
				},
			])
			.run();
	});

	it('listBranchesForProject returns branches sorted by last activity', () => {
		const branches = listBranchesForProject(db.index, 'proj-a');
		expect(branches).toHaveLength(2);
		expect(branches[0]!.branch).toBe('feature-x');
		expect(branches[0]!.sessionCount).toBe(2);
		expect(branches[1]!.branch).toBe('main');
		expect(branches[1]!.sessionCount).toBe(1);
	});

	it('listBranchesForProject excludes sidechains', () => {
		const branches = listBranchesForProject(db.index, 'proj-a');
		const featureX = branches.find((b) => b.branch === 'feature-x');
		expect(featureX!.sessionCount).toBe(2);
	});

	it('listSessionsForBranch returns sessions for a specific branch', () => {
		const sessions = listSessionsForBranch(db.index, 'proj-a', 'feature-x');
		expect(sessions).toHaveLength(2);
		expect(sessions[0]!.id).toBe('b-sess-1');
		expect(sessions[1]!.id).toBe('b-sess-2');
	});

	it('listSessionsForBranch returns empty for non-existent branch', () => {
		const sessions = listSessionsForBranch(db.index, 'proj-a', 'nonexistent');
		expect(sessions).toHaveLength(0);
	});

	it('listCwdsForProject returns unique cwds sorted by last activity', () => {
		const cwds = listCwdsForProject(db.index, 'proj-a');
		expect(cwds).toHaveLength(2);
		expect(cwds[0]!.cwd).toBe('/projects/alpha');
		expect(cwds[0]!.sessionCount).toBe(2);
		expect(cwds[1]!.cwd).toBe('/projects/alpha-worktree');
		expect(cwds[1]!.sessionCount).toBe(1);
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

	it('getSubagentsForProject returns subagents across all sessions in the project', () => {
		db.index.insert(schema.projects).values({id: 'proj-y', name: 'Y', updatedAt: 1000}).run();
		db.index
			.insert(schema.subagents)
			.values([
				{
					id: 'agent-1',
					sessionId: 'sess-1',
					projectId: 'proj-y',
					agentType: 'Explore',
					slug: null,
					filePath: '/path/agent-1.jsonl',
					mtimeMs: 1000,
				},
				{
					id: 'agent-2',
					sessionId: 'sess-2',
					projectId: 'proj-y',
					agentType: 'Plan',
					slug: null,
					filePath: '/path/agent-2.jsonl',
					mtimeMs: 2000,
				},
				{
					id: 'agent-3',
					sessionId: 'sess-3',
					projectId: 'proj-other',
					agentType: 'Explore',
					slug: null,
					filePath: '/path/agent-3.jsonl',
					mtimeMs: 3000,
				},
			])
			.run();

		const agents = getSubagentsForProject(db.index, 'proj-y');
		expect(agents).toHaveLength(2);
		expect(agents.map((a) => a.id).sort()).toEqual(['agent-1', 'agent-2']);
	});

	it('getSubagentsForProject returns empty array when project has no subagents', () => {
		expect(getSubagentsForProject(db.index, 'nonexistent-project')).toEqual([]);
	});

	it('returns empty array for session with no subagents', () => {
		expect(getSubagentsForSession(db.index, 'nonexistent')).toEqual([]);
	});

	it('indexSubagentFile extracts startedAt and finishedAt from JSONL timestamps', async () => {
		const projectDir = join(testDir, '-Users-craig-projects-app');
		const sessionDir = join(projectDir, 'sess-1', 'subagents');
		mkdirSync(sessionDir, {recursive: true});

		const agentPath = join(sessionDir, 'agent-abc123.jsonl');
		writeFileSync(
			agentPath,
			jsonl(
				{
					type: 'user',
					slug: 'explore-stuff',
					timestamp: '2026-04-05T00:28:53.989Z',
					message: {role: 'user', content: 'Do something'},
				},
				{
					type: 'assistant',
					timestamp: '2026-04-05T00:29:05.000Z',
					message: {role: 'assistant', content: 'Working on it'},
				},
				{
					type: 'assistant',
					timestamp: '2026-04-05T00:29:12.217Z',
					message: {role: 'assistant', content: 'Done'},
				},
			),
		);

		db.index.insert(schema.projects).values({id: 'proj-app', name: 'App', updatedAt: 1000}).run();
		await indexSubagentFile(db.index, agentPath, 'sess-1', 'proj-app');

		const agent = db.index.select().from(schema.subagents).where(eq(schema.subagents.id, 'agent-abc123')).get();
		expect(agent).toBeDefined();
		expect(agent!.startedAt).toBe('2026-04-05T00:28:53.989Z');
		expect(agent!.finishedAt).toBe('2026-04-05T00:29:12.217Z');
	});

	it('indexSubagentFile reads agentType and description from sibling meta.json', async () => {
		const projectDir = join(testDir, '-Users-craig-projects-app');
		const sessionDir = join(projectDir, 'sess-1', 'subagents');
		mkdirSync(sessionDir, {recursive: true});

		const agentPath = join(sessionDir, 'agent-meta1.jsonl');
		writeFileSync(
			agentPath,
			jsonl({
				type: 'user',
				slug: 'lemur-1',
				timestamp: '2026-04-05T00:28:53.000Z',
				message: {role: 'user', content: 'go'},
			}),
		);
		writeFileSync(
			agentPath.replace(/\.jsonl$/, '.meta.json'),
			JSON.stringify({agentType: 'Explore', description: 'Map current render pipeline'}),
		);

		db.index.insert(schema.projects).values({id: 'proj-app', name: 'App', updatedAt: 1000}).run();
		await indexSubagentFile(db.index, agentPath, 'sess-1', 'proj-app');

		const agent = db.index.select().from(schema.subagents).where(eq(schema.subagents.id, 'agent-meta1')).get();
		expect(agent).toBeDefined();
		expect(agent!.agentType).toBe('Explore');
		expect(agent!.description).toBe('Map current render pipeline');
	});

	it('linkSubagentParents sets parentAgentId from Agent tool calls in parent JSONL', async () => {
		const projectDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projectDir, {recursive: true});

		// Create parent session JSONL with Agent tool calls
		const parentJsonl = join(projectDir, 'sess-1.jsonl');
		writeFileSync(
			parentJsonl,
			jsonl(
				{type: 'user', message: {role: 'user', content: 'Do work'}},
				{
					type: 'assistant',
					timestamp: '2026-04-05T00:10:00.000Z',
					message: {
						role: 'assistant',
						content: [
							{type: 'text', text: 'Let me spawn some agents'},
							{
								type: 'tool_use',
								id: 'tool-1',
								name: 'Agent',
								input: {prompt: 'explore', subagent_type: 'Explore', description: 'Search codebase'},
							},
							{
								type: 'tool_use',
								id: 'tool-2',
								name: 'Agent',
								input: {
									prompt: 'review code',
									subagent_type: 'general-purpose',
									description: 'Code review',
								},
							},
						],
					},
				},
				{
					type: 'user',
					message: {
						role: 'user',
						content: [
							{type: 'tool_result', tool_use_id: 'tool-1', content: 'agentId: abc123\nFound files'},
							{type: 'tool_result', tool_use_id: 'tool-2', content: 'agentId: def456\nReview complete'},
						],
					},
				},
			),
		);

		// Insert subagent rows (as if indexSubagentFile already ran)
		db.index.insert(schema.projects).values({id: 'proj-app', name: 'App', updatedAt: 1000}).run();
		db.index
			.insert(schema.subagents)
			.values([
				{
					id: 'agent-abc123',
					sessionId: 'sess-1',
					projectId: 'proj-app',
					filePath: '/path/agent-abc123.jsonl',
					mtimeMs: 1000,
				},
				{
					id: 'agent-def456',
					sessionId: 'sess-1',
					projectId: 'proj-app',
					filePath: '/path/agent-def456.jsonl',
					mtimeMs: 1000,
				},
				{
					id: 'agent-other',
					sessionId: 'sess-1',
					projectId: 'proj-app',
					filePath: '/path/agent-other.jsonl',
					mtimeMs: 1000,
				},
			])
			.run();

		await linkSubagentParents(db.index, parentJsonl, null);

		const abc = db.index.select().from(schema.subagents).where(eq(schema.subagents.id, 'agent-abc123')).get();
		expect(abc!.parentAgentId).toBeNull(); // root-spawned → null
		expect(abc!.description).toBe('Search codebase');

		const def = db.index.select().from(schema.subagents).where(eq(schema.subagents.id, 'agent-def456')).get();
		expect(def!.parentAgentId).toBeNull(); // root-spawned → null
		expect(def!.description).toBe('Code review');

		const other = db.index.select().from(schema.subagents).where(eq(schema.subagents.id, 'agent-other')).get();
		expect(other!.parentAgentId).toBeNull(); // not mentioned in JSONL, stays null
	});

	it('linkSubagentParents sets parentAgentId for nested subagents', async () => {
		const projectDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projectDir, {recursive: true});

		// Create a subagent JSONL that spawns another subagent
		const parentAgentJsonl = join(projectDir, 'agent-parent111.jsonl');
		writeFileSync(
			parentAgentJsonl,
			jsonl(
				{type: 'user', message: {role: 'user', content: 'Research something'}},
				{
					type: 'assistant',
					message: {
						role: 'assistant',
						content: [
							{
								type: 'tool_use',
								id: 'tool-nested',
								name: 'Agent',
								input: {prompt: 'deep scan', subagent_type: 'Explore'},
							},
						],
					},
				},
				{
					type: 'user',
					message: {
						role: 'user',
						content: [
							{type: 'tool_result', tool_use_id: 'tool-nested', content: 'agentId: child222\nResults'},
						],
					},
				},
			),
		);

		db.index.insert(schema.projects).values({id: 'proj-app', name: 'App', updatedAt: 1000}).run();
		db.index
			.insert(schema.subagents)
			.values([
				{
					id: 'agent-parent111',
					sessionId: 'sess-1',
					projectId: 'proj-app',
					filePath: parentAgentJsonl,
					mtimeMs: 1000,
				},
				{
					id: 'agent-child222',
					sessionId: 'sess-1',
					projectId: 'proj-app',
					filePath: '/path/agent-child222.jsonl',
					mtimeMs: 1000,
				},
			])
			.run();

		await linkSubagentParents(db.index, parentAgentJsonl, 'agent-parent111');

		const child = db.index.select().from(schema.subagents).where(eq(schema.subagents.id, 'agent-child222')).get();
		expect(child!.parentAgentId).toBe('agent-parent111');
	});

	it('linkSubagentParents does not overwrite existing parentAgentId with null', async () => {
		const projectDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projectDir, {recursive: true});

		// Root session JSONL that also mentions agent-child222 (e.g. via acompact replay)
		const rootJsonl = join(projectDir, 'sess-1.jsonl');
		writeFileSync(
			rootJsonl,
			jsonl(
				{type: 'user', message: {role: 'user', content: 'Do work'}},
				{
					type: 'assistant',
					message: {
						role: 'assistant',
						content: [
							{
								type: 'tool_use',
								id: 'tool-root',
								name: 'Agent',
								input: {prompt: 'scan', description: 'Root agent call'},
							},
						],
					},
				},
				{
					type: 'user',
					message: {
						role: 'user',
						content: [{type: 'tool_result', tool_use_id: 'tool-root', content: 'agentId: child222\nDone'}],
					},
				},
			),
		);

		db.index.insert(schema.projects).values({id: 'proj-app', name: 'App', updatedAt: 1000}).run();
		db.index
			.insert(schema.subagents)
			.values([
				{
					id: 'agent-child222',
					sessionId: 'sess-1',
					projectId: 'proj-app',
					parentAgentId: 'agent-parent111',
					filePath: '/path/agent-child222.jsonl',
					mtimeMs: 1000,
				},
			])
			.run();

		// Root pass with parentAgentId=null should NOT overwrite the existing parent
		await linkSubagentParents(db.index, rootJsonl, null);

		const child = db.index.select().from(schema.subagents).where(eq(schema.subagents.id, 'agent-child222')).get();
		expect(child!.parentAgentId).toBe('agent-parent111');
		// Description should still be updated even when parentAgentId is preserved
		expect(child!.description).toBe('Root agent call');
	});
});

describe('buildSubagentTree', () => {
	function makeAgent(overrides: Partial<DbSubagent> & {id: string}): DbSubagent {
		return {
			sessionId: 'sess-1',
			projectId: 'proj-1',
			parentAgentId: null,
			agentType: null,
			slug: null,
			description: null,
			startedAt: null,
			finishedAt: null,
			filePath: `/path/${overrides.id}.jsonl`,
			mtimeMs: 1000,
			...overrides,
		};
	}

	it('builds a flat list for serial agents', () => {
		const agents = [
			makeAgent({id: 'a', startedAt: '2026-04-05T00:00:00.000Z', finishedAt: '2026-04-05T00:00:10.000Z'}),
			makeAgent({id: 'b', startedAt: '2026-04-05T00:00:15.000Z', finishedAt: '2026-04-05T00:00:25.000Z'}),
			makeAgent({id: 'c', startedAt: '2026-04-05T00:00:30.000Z', finishedAt: '2026-04-05T00:00:40.000Z'}),
		];

		const tree = buildSubagentTree(agents);
		expect(tree).toHaveLength(3);
		expect((tree[0] as SubagentTreeNode).agent.id).toBe('a');
		expect((tree[1] as SubagentTreeNode).agent.id).toBe('b');
		expect((tree[2] as SubagentTreeNode).agent.id).toBe('c');
	});

	it('groups parallel agents with same start time', () => {
		const agents = [
			makeAgent({id: 'build', startedAt: '2026-04-05T00:00:00.000Z', finishedAt: '2026-04-05T00:00:10.000Z'}),
			makeAgent({id: 'review1', startedAt: '2026-04-05T00:00:15.000Z', finishedAt: '2026-04-05T00:00:25.000Z'}),
			makeAgent({id: 'review2', startedAt: '2026-04-05T00:00:15.000Z', finishedAt: '2026-04-05T00:00:30.000Z'}),
			makeAgent({id: 'review3', startedAt: '2026-04-05T00:00:15.500Z', finishedAt: '2026-04-05T00:00:20.000Z'}),
			makeAgent({id: 'commit', startedAt: '2026-04-05T00:00:35.000Z', finishedAt: '2026-04-05T00:00:40.000Z'}),
		];

		const tree = buildSubagentTree(agents);
		expect(tree).toHaveLength(3);
		expect((tree[0] as SubagentTreeNode).agent.id).toBe('build');

		const group = tree[1] as ParallelGroup;
		expect(group.type).toBe('parallel');
		expect(group.children).toHaveLength(3);
		expect(group.wallClockMs).toBe(15000); // review2 took longest: 15s

		expect((tree[2] as SubagentTreeNode).agent.id).toBe('commit');
	});

	it('nests children under their parent', () => {
		const agents = [
			makeAgent({id: 'parent', startedAt: '2026-04-05T00:00:00.000Z', finishedAt: '2026-04-05T00:00:30.000Z'}),
			makeAgent({
				id: 'child',
				parentAgentId: 'parent',
				startedAt: '2026-04-05T00:00:05.000Z',
				finishedAt: '2026-04-05T00:00:15.000Z',
			}),
		];

		const tree = buildSubagentTree(agents);
		expect(tree).toHaveLength(1);

		const parent = tree[0] as SubagentTreeNode;
		expect(parent.agent.id).toBe('parent');
		expect(parent.children).toHaveLength(1);
		expect((parent.children[0] as SubagentTreeNode).agent.id).toBe('child');
	});

	it('handles deep nesting', () => {
		const agents = [
			makeAgent({
				id: 'root-agent',
				startedAt: '2026-04-05T00:00:00.000Z',
				finishedAt: '2026-04-05T00:01:00.000Z',
			}),
			makeAgent({
				id: 'mid',
				parentAgentId: 'root-agent',
				startedAt: '2026-04-05T00:00:10.000Z',
				finishedAt: '2026-04-05T00:00:40.000Z',
			}),
			makeAgent({
				id: 'deep',
				parentAgentId: 'mid',
				startedAt: '2026-04-05T00:00:15.000Z',
				finishedAt: '2026-04-05T00:00:25.000Z',
			}),
		];

		const tree = buildSubagentTree(agents);
		expect(tree).toHaveLength(1);
		const root = tree[0] as SubagentTreeNode;
		expect(root.children).toHaveLength(1);
		const mid = root.children[0] as SubagentTreeNode;
		expect(mid.children).toHaveLength(1);
		expect((mid.children[0] as SubagentTreeNode).agent.id).toBe('deep');
	});

	it('returns empty array for no agents', () => {
		expect(buildSubagentTree([])).toEqual([]);
	});
});

describe('starred sessions', () => {
	beforeEach(() => {
		db.index
			.insert(schema.projects)
			.values({id: 'proj-a', name: 'Alpha', projectPath: '/projects/alpha', updatedAt: 2000})
			.run();
		db.index
			.insert(schema.sessions)
			.values([
				{
					id: 'sess-1',
					projectId: 'proj-a',
					title: 'Fix login',
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
					messageCount: 3,
					isSidechain: 0,
					createdAt: 500,
					mtimeMs: 2000,
					filePath: '/path/sess-2.jsonl',
				},
			])
			.run();
	});

	it('isSessionStarred returns false for unstarred session', () => {
		expect(isSessionStarred(db.index, 'sess-1')).toBe(false);
	});

	it('toggleStar stars and unstars a session', () => {
		const starred = toggleStar(db.index, 'sess-1');
		expect(starred).toBe(true);
		expect(isSessionStarred(db.index, 'sess-1')).toBe(true);

		const unstarred = toggleStar(db.index, 'sess-1');
		expect(unstarred).toBe(false);
		expect(isSessionStarred(db.index, 'sess-1')).toBe(false);
	});

	it('getStarredSessionIds returns set of starred IDs', () => {
		toggleStar(db.index, 'sess-1');
		toggleStar(db.index, 'sess-2');

		const ids = getStarredSessionIds(db.index);
		expect(ids.size).toBe(2);
		expect(ids.has('sess-1')).toBe(true);
		expect(ids.has('sess-2')).toBe(true);
	});

	it('getStarredSessions returns full session entries', () => {
		toggleStar(db.index, 'sess-1');

		const sessions = getStarredSessions(db.index);
		expect(sessions).toHaveLength(1);
		expect(sessions[0]!.id).toBe('sess-1');
		expect(sessions[0]!.title).toBe('Fix login');
		expect(sessions[0]!.projectName).toBe('Alpha');
	});

	it('getStarredSessions returns empty array when none starred', () => {
		expect(getStarredSessions(db.index)).toEqual([]);
	});
});

describe('message content FTS', () => {
	beforeEach(async () => {
		const projectDir = join(testDir, '-Users-craig-projects-app');
		mkdirSync(projectDir, {recursive: true});

		writeFileSync(
			join(projectDir, 'sessions-index.json'),
			makeSessionsIndex([
				{
					sessionId: 'fts-sess-1',
					fullPath: join(projectDir, 'fts-sess-1.jsonl'),
					fileMtime: Date.now(),
					firstPrompt: 'Hello',
					messageCount: 2,
				},
			]),
		);
		await indexSessionsIndex(db.index, projectDir, '-Users-craig-projects-app');

		writeFileSync(
			join(projectDir, 'fts-sess-1.jsonl'),
			jsonl(
				{type: 'user', message: {role: 'user', content: 'Fix the authentication bug in the login form'}},
				{
					type: 'assistant',
					message: {
						role: 'assistant',
						content: [{type: 'text', text: 'I found the issue in the session middleware'}],
					},
				},
			),
		);
		await indexJsonlFile(db.index, join(projectDir, 'fts-sess-1.jsonl'), '-Users-craig-projects-app');
	});

	it('indexes and searches message content', () => {
		const results = searchMessageContent(db.index, 'authentication');
		expect(results.length).toBe(1);
		expect(results[0]!.sessionId).toBe('fts-sess-1');
	});

	it('finds assistant message content', () => {
		const results = searchMessageContent(db.index, 'middleware');
		expect(results.length).toBe(1);
		expect(results[0]!.sessionId).toBe('fts-sess-1');
	});

	it('returns snippet with highlight marks', () => {
		const results = searchMessageContent(db.index, 'login');
		expect(results.length).toBe(1);
		expect(results[0]!.snippet).toContain('<mark>');
	});

	it('returns empty for non-matching query', () => {
		const results = searchMessageContent(db.index, 'nonexistent');
		expect(results.length).toBe(0);
	});
});

describe('task indexer', () => {
	function makeTaskFile(task: Record<string, unknown>): string {
		return JSON.stringify({
			id: '1',
			subject: 'Test task',
			description: 'Test description',
			status: 'pending',
			blocks: [],
			blockedBy: [],
			...task,
		});
	}

	it('indexes a task file', async () => {
		const tasksDir = join(testDir, 'tasks', 'my-project');
		mkdirSync(tasksDir, {recursive: true});

		const filePath = join(tasksDir, '1.json');
		writeFileSync(filePath, makeTaskFile({id: '1', subject: 'Fix bug', status: 'completed'}));

		await indexTaskFile(db.index, filePath, 'my-project');

		const tasks = db.index.select().from(schema.tasks).all();
		expect(tasks).toHaveLength(1);
		expect(tasks[0]!.taskId).toBe('1');
		expect(tasks[0]!.projectDir).toBe('my-project');
		expect(tasks[0]!.subject).toBe('Fix bug');
		expect(tasks[0]!.status).toBe('completed');
	});

	it('stores blocks and blockedBy as JSON', async () => {
		const tasksDir = join(testDir, 'tasks', 'my-project');
		mkdirSync(tasksDir, {recursive: true});

		const filePath = join(tasksDir, '2.json');
		writeFileSync(filePath, makeTaskFile({id: '2', blocks: ['3'], blockedBy: ['1']}));

		await indexTaskFile(db.index, filePath, 'my-project');

		const tasks = db.index.select().from(schema.tasks).all();
		expect(tasks).toHaveLength(1);
		expect(JSON.parse(tasks[0]!.blocksJson)).toEqual(['3']);
		expect(JSON.parse(tasks[0]!.blockedByJson)).toEqual(['1']);
	});

	it('skips re-indexing when mtime unchanged', async () => {
		const tasksDir = join(testDir, 'tasks', 'my-project');
		mkdirSync(tasksDir, {recursive: true});

		const filePath = join(tasksDir, '1.json');
		writeFileSync(filePath, makeTaskFile({}));

		await indexTaskFile(db.index, filePath, 'my-project');
		const firstIndexed = db.index
			.select()
			.from(schema.indexedFiles)
			.where(eq(schema.indexedFiles.path, filePath))
			.get();

		await indexTaskFile(db.index, filePath, 'my-project');
		const secondIndexed = db.index
			.select()
			.from(schema.indexedFiles)
			.where(eq(schema.indexedFiles.path, filePath))
			.get();

		expect(secondIndexed!.indexedAt).toBe(firstIndexed!.indexedAt);
	});

	it('re-indexes when indexed_files entry exists but tasks row is missing', async () => {
		const tasksDir = join(testDir, 'tasks', 'my-project');
		mkdirSync(tasksDir, {recursive: true});

		const filePath = join(tasksDir, '1.json');
		writeFileSync(filePath, makeTaskFile({id: '1', subject: 'Fix bug'}));

		await indexTaskFile(db.index, filePath, 'my-project');
		expect(db.index.select().from(schema.tasks).all()).toHaveLength(1);

		db.index.delete(schema.tasks).where(eq(schema.tasks.filePath, filePath)).run();
		expect(db.index.select().from(schema.tasks).all()).toHaveLength(0);
		expect(
			db.index.select().from(schema.indexedFiles).where(eq(schema.indexedFiles.path, filePath)).get(),
		).toBeTruthy();

		await indexTaskFile(db.index, filePath, 'my-project');
		expect(db.index.select().from(schema.tasks).all()).toHaveLength(1);
		expect(db.index.select().from(schema.tasks).all()[0]!.subject).toBe('Fix bug');
	});

	it('re-indexes when file changes', async () => {
		const tasksDir = join(testDir, 'tasks', 'my-project');
		mkdirSync(tasksDir, {recursive: true});

		const filePath = join(tasksDir, '1.json');
		writeFileSync(filePath, makeTaskFile({status: 'pending'}));

		await indexTaskFile(db.index, filePath, 'my-project');
		expect(db.index.select().from(schema.tasks).all()[0]!.status).toBe('pending');

		await new Promise((r) => setTimeout(r, 50));

		writeFileSync(filePath, makeTaskFile({status: 'completed'}));
		await indexTaskFile(db.index, filePath, 'my-project');
		expect(db.index.select().from(schema.tasks).all()[0]!.status).toBe('completed');
	});
});

describe('scanTasksDir', () => {
	it('indexes task files across project directories', async () => {
		const tasksDir = join(testDir, 'tasks');
		const proj1 = join(tasksDir, 'project-a');
		const proj2 = join(tasksDir, 'project-b');
		mkdirSync(proj1, {recursive: true});
		mkdirSync(proj2, {recursive: true});

		writeFileSync(
			join(proj1, '1.json'),
			JSON.stringify({
				id: '1',
				subject: 'Task A',
				description: 'desc',
				status: 'pending',
				blocks: [],
				blockedBy: [],
			}),
		);
		writeFileSync(
			join(proj2, '2.json'),
			JSON.stringify({
				id: '2',
				subject: 'Task B',
				description: 'desc',
				status: 'completed',
				blocks: [],
				blockedBy: [],
			}),
		);

		await scanTasksDir(db.index, tasksDir);

		const tasks = db.index.select().from(schema.tasks).all();
		expect(tasks).toHaveLength(2);
		expect(tasks.map((t) => t.projectDir).sort()).toEqual(['project-a', 'project-b']);
	});

	it('cleans up deleted files', async () => {
		const tasksDir = join(testDir, 'tasks');
		const proj = join(tasksDir, 'my-proj');
		mkdirSync(proj, {recursive: true});

		const filePath = join(proj, '1.json');
		writeFileSync(
			filePath,
			JSON.stringify({
				id: '1',
				subject: 'Task',
				description: 'desc',
				status: 'pending',
				blocks: [],
				blockedBy: [],
			}),
		);

		await scanTasksDir(db.index, tasksDir);
		expect(db.index.select().from(schema.tasks).all()).toHaveLength(1);

		rmSync(filePath);
		await scanTasksDir(db.index, tasksDir);
		expect(db.index.select().from(schema.tasks).all()).toHaveLength(0);
	});
});

describe('task queries', () => {
	beforeEach(async () => {
		const tasksDir = join(testDir, 'tasks', 'app');
		mkdirSync(tasksDir, {recursive: true});

		writeFileSync(
			join(tasksDir, '1.json'),
			JSON.stringify({
				id: '1',
				subject: 'Fix bug',
				description: 'Fix it',
				status: 'completed',
				blocks: ['2'],
				blockedBy: [],
			}),
		);
		writeFileSync(
			join(tasksDir, '2.json'),
			JSON.stringify({
				id: '2',
				subject: 'Write tests',
				description: 'Test it',
				status: 'pending',
				blocks: [],
				blockedBy: ['1'],
			}),
		);
		writeFileSync(
			join(tasksDir, '3.json'),
			JSON.stringify({
				id: '3',
				subject: 'Deploy',
				description: 'Ship it',
				status: 'in_progress',
				blocks: [],
				blockedBy: [],
				activeForm: 'Deploying',
			}),
		);
		await scanTasksDir(db.index, join(testDir, 'tasks'));
	});

	it('getTasksForProject returns all tasks for a project', () => {
		const tasks = getTasksForProject(db.index, 'app');
		expect(tasks).toHaveLength(3);
		expect(tasks.map((t) => t.subject).sort()).toEqual(['Deploy', 'Fix bug', 'Write tests']);
	});

	it('getTasksForProject parses blocks/blockedBy', () => {
		const tasks = getTasksForProject(db.index, 'app');
		const task1 = tasks.find((t) => t.taskId === '1');
		expect(task1!.blocks).toEqual(['2']);
		expect(task1!.blockedBy).toEqual([]);

		const task2 = tasks.find((t) => t.taskId === '2');
		expect(task2!.blockedBy).toEqual(['1']);
	});

	it('getTasksForProject returns empty for unknown project', () => {
		expect(getTasksForProject(db.index, 'nonexistent')).toEqual([]);
	});

	it('getTaskCountsForProject aggregates correctly', () => {
		const counts = getTaskCountsForProject(db.index, 'app');
		expect(counts.total).toBe(3);
		expect(counts.completed).toBe(1);
		expect(counts.pending).toBe(1);
		expect(counts.inProgress).toBe(1);
	});

	it('getTaskCountsForProject returns zeros for unknown project', () => {
		const counts = getTaskCountsForProject(db.index, 'nonexistent');
		expect(counts).toEqual({total: 0, pending: 0, inProgress: 0, completed: 0});
	});

	it('getIncompleteTasksGroupedByProject groups correctly', () => {
		const groups = getIncompleteTasksGroupedByProject(db.index);
		expect(groups).toHaveLength(1);
		expect(groups[0]!.projectDir).toBe('app');
		expect(groups[0]!.totalPending).toBe(1);
		expect(groups[0]!.totalInProgress).toBe(1);
		expect(groups[0]!.tasks).toHaveLength(2);
	});

	it('getIncompleteTasksGroupedByProject returns empty when all completed', async () => {
		const tasksDir = join(testDir, 'tasks', 'app');
		await new Promise((r) => setTimeout(r, 50));
		writeFileSync(
			join(tasksDir, '2.json'),
			JSON.stringify({
				id: '2',
				subject: 'Write tests',
				description: 'Test it',
				status: 'completed',
				blocks: [],
				blockedBy: ['1'],
			}),
		);
		writeFileSync(
			join(tasksDir, '3.json'),
			JSON.stringify({
				id: '3',
				subject: 'Deploy',
				description: 'Ship it',
				status: 'completed',
				blocks: [],
				blockedBy: [],
			}),
		);
		await scanTasksDir(db.index, join(testDir, 'tasks'));

		const groups = getIncompleteTasksGroupedByProject(db.index);
		expect(groups).toEqual([]);
	});
});
