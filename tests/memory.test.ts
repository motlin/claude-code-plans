import {writeFileSync, mkdirSync, rmSync, utimesSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir, homedir} from 'node:os';
import {decodeProjectDir, listMemories, readMemory, getProjectsDir} from '../src/memory.js';

const testDir = join(tmpdir(), 'claude-memory-test-' + process.pid);

beforeEach(() => {
	mkdirSync(testDir, {recursive: true});
});

afterEach(() => {
	rmSync(testDir, {recursive: true, force: true});
});

describe('decodeProjectDir', () => {
	it('decodes a simple project path', () => {
		// Encoding is ambiguous for dirs with hyphens — best-effort extracts last segment
		expect(decodeProjectDir('-Users-craig-projects-myapp')).toBe('myapp');
	});

	it('extracts last path component', () => {
		expect(decodeProjectDir('-Users-craig-deep-nested-project')).toBe('project');
	});

	it('handles single-segment name', () => {
		expect(decodeProjectDir('-home-user-code')).toBe('code');
	});
});

describe('listMemories', () => {
	it('returns empty array when no project dirs exist', async () => {
		const groups = await listMemories(testDir);
		expect(groups).toEqual([]);
	});

	it('returns empty array when directory does not exist', async () => {
		const groups = await listMemories(join(testDir, 'nonexistent'));
		expect(groups).toEqual([]);
	});

	it('lists memory files grouped by project', async () => {
		const projectDir = join(testDir, '-Users-craig-projects-app');
		const memDir = join(projectDir, 'memory');
		mkdirSync(memDir, {recursive: true});
		writeFileSync(join(memDir, 'MEMORY.md'), '# Memory\n\nSome notes');
		writeFileSync(join(memDir, 'patterns.md'), '# Patterns\n\nSome patterns');

		const groups = await listMemories(testDir);
		expect(groups).toHaveLength(1);
		expect(groups[0]!.project).toBe('-Users-craig-projects-app');
		expect(groups[0]!.projectName).toBe('app');
		expect(groups[0]!.memories).toHaveLength(2);
	});

	it('skips projects without memory directories', async () => {
		mkdirSync(join(testDir, '-Users-craig-projects-no-memory'), {recursive: true});

		const groups = await listMemories(testDir);
		expect(groups).toEqual([]);
	});

	it('skips non-md files in memory dirs', async () => {
		const memDir = join(testDir, '-Users-craig-projects-app', 'memory');
		mkdirSync(memDir, {recursive: true});
		writeFileSync(join(memDir, 'MEMORY.md'), '# Memory');
		writeFileSync(join(memDir, 'notes.txt'), 'not markdown');

		const groups = await listMemories(testDir);
		expect(groups[0]!.memories).toHaveLength(1);
		expect(groups[0]!.memories[0]!.filename).toBe('MEMORY.md');
	});

	it('sorts groups by most recent mtime', async () => {
		const olderMemDir = join(testDir, '-Users-craig-projects-older', 'memory');
		const newerMemDir = join(testDir, '-Users-craig-projects-newer', 'memory');
		mkdirSync(olderMemDir, {recursive: true});
		mkdirSync(newerMemDir, {recursive: true});

		writeFileSync(join(olderMemDir, 'MEMORY.md'), '# Older');
		writeFileSync(join(newerMemDir, 'MEMORY.md'), '# Newer');

		const pastTime = new Date(Date.now() - 60000);
		utimesSync(join(olderMemDir, 'MEMORY.md'), pastTime, pastTime);

		const groups = await listMemories(testDir);
		expect(groups).toHaveLength(2);
		expect(groups[0]!.project).toBe('-Users-craig-projects-newer');
		expect(groups[1]!.project).toBe('-Users-craig-projects-older');
	});

	it('extracts title from # heading', async () => {
		const memDir = join(testDir, '-Users-craig-projects-app', 'memory');
		mkdirSync(memDir, {recursive: true});
		writeFileSync(join(memDir, 'patterns.md'), '# Coding Patterns\n\nContent');

		const groups = await listMemories(testDir);
		expect(groups[0]!.memories[0]!.title).toBe('Coding Patterns');
	});

	it('falls back to humanized filename when no heading', async () => {
		const memDir = join(testDir, '-Users-craig-projects-app', 'memory');
		mkdirSync(memDir, {recursive: true});
		writeFileSync(join(memDir, 'debug-notes.md'), 'No heading here');

		const groups = await listMemories(testDir);
		expect(groups[0]!.memories[0]!.title).toBe('Debug Notes');
	});
});

describe('readMemory', () => {
	it('reads a valid memory file', async () => {
		const memDir = join(testDir, '-Users-craig-projects-app', 'memory');
		mkdirSync(memDir, {recursive: true});
		writeFileSync(join(memDir, 'MEMORY.md'), '# Memory\n\nContent');

		const content = await readMemory(testDir, '-Users-craig-projects-app', 'MEMORY.md');
		expect(content).toBe('# Memory\n\nContent');
	});

	it('returns null for non-existent file', async () => {
		const memDir = join(testDir, '-Users-craig-projects-app', 'memory');
		mkdirSync(memDir, {recursive: true});

		const content = await readMemory(testDir, '-Users-craig-projects-app', 'nope.md');
		expect(content).toBeNull();
	});

	it('rejects path traversal in project param', async () => {
		const content = await readMemory(testDir, '../etc', 'passwd.md');
		expect(content).toBeNull();
	});

	it('rejects path traversal in filename param', async () => {
		const content = await readMemory(testDir, '-Users-craig-projects-app', '../../../etc/passwd');
		expect(content).toBeNull();
	});

	it('rejects slash in filename', async () => {
		const content = await readMemory(testDir, '-Users-craig-projects-app', 'sub/file.md');
		expect(content).toBeNull();
	});

	it('rejects non-md extension', async () => {
		const memDir = join(testDir, '-Users-craig-projects-app', 'memory');
		mkdirSync(memDir, {recursive: true});
		writeFileSync(join(memDir, 'secret.txt'), 'secret');

		const content = await readMemory(testDir, '-Users-craig-projects-app', 'secret.txt');
		expect(content).toBeNull();
	});

	it('rejects slash in project param', async () => {
		const content = await readMemory(testDir, 'foo/bar', 'MEMORY.md');
		expect(content).toBeNull();
	});
});

describe('getProjectsDir', () => {
	it('returns path under ~/.claude/projects', () => {
		const dir = getProjectsDir();
		expect(dir).toBe(join(homedir(), '.claude', 'projects'));
	});
});
