import {writeFileSync, mkdirSync, rmSync, utimesSync, readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir, homedir} from 'node:os';
import {
	decodeProjectDir,
	listMemories,
	readMemory,
	writeMemory,
	deleteMemory,
	getProjectsDir,
} from '../src/lib/memory.js';

const testDir = join(tmpdir(), 'claude-memory-test-' + process.pid);

beforeEach(() => {
	mkdirSync(testDir, {recursive: true});
});

afterEach(() => {
	rmSync(testDir, {recursive: true, force: true});
});

describe('decodeProjectDir', () => {
	it('returns full decoded path when no projectPath given', () => {
		expect(decodeProjectDir('-Users-craig-projects-myapp')).toBe('/Users/craig/projects/myapp');
	});

	it('returns full decoded path (hyphens are ambiguous without filesystem)', () => {
		expect(decodeProjectDir('-Users-craig-deep-nested-project')).toBe('/Users/craig/deep/nested/project');
	});

	it('uses last segment of projectPath when provided', () => {
		expect(decodeProjectDir('-Users-craig-projects-my-app', '/Users/craig/projects/my-app')).toBe('my-app');
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
		expect(groups[0]!.projectName).toBe('/Users/craig/projects/app');
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

describe('writeMemory', () => {
	it('writes content to a memory file', async () => {
		const memDir = join(testDir, '-Users-craig-projects-app', 'memory');
		mkdirSync(memDir, {recursive: true});

		const ok = await writeMemory(testDir, '-Users-craig-projects-app', 'notes.md', '# Notes\n\nContent');
		expect(ok).toBe(true);
		const written = readFileSync(join(memDir, 'notes.md'), 'utf-8');
		expect(written).toBe('# Notes\n\nContent');
	});

	it('overwrites an existing memory file', async () => {
		const memDir = join(testDir, '-Users-craig-projects-app', 'memory');
		mkdirSync(memDir, {recursive: true});
		writeFileSync(join(memDir, 'MEMORY.md'), '# Old');

		const ok = await writeMemory(testDir, '-Users-craig-projects-app', 'MEMORY.md', '# Updated');
		expect(ok).toBe(true);
		const written = readFileSync(join(memDir, 'MEMORY.md'), 'utf-8');
		expect(written).toBe('# Updated');
	});

	it('rejects path traversal in project param', async () => {
		const ok = await writeMemory(testDir, '../etc', 'file.md', 'bad');
		expect(ok).toBe(false);
	});

	it('rejects path traversal in filename param', async () => {
		const ok = await writeMemory(testDir, '-Users-craig-projects-app', '../../../etc/passwd.md', 'bad');
		expect(ok).toBe(false);
	});

	it('rejects slash in project param', async () => {
		const ok = await writeMemory(testDir, 'foo/bar', 'file.md', 'bad');
		expect(ok).toBe(false);
	});

	it('rejects slash in filename', async () => {
		const ok = await writeMemory(testDir, '-Users-craig-projects-app', 'sub/file.md', 'bad');
		expect(ok).toBe(false);
	});

	it('rejects non-md extension', async () => {
		const ok = await writeMemory(testDir, '-Users-craig-projects-app', 'file.txt', 'bad');
		expect(ok).toBe(false);
	});
});

describe('deleteMemory', () => {
	it('deletes an existing memory file', async () => {
		const memDir = join(testDir, '-Users-craig-projects-app', 'memory');
		mkdirSync(memDir, {recursive: true});
		writeFileSync(join(memDir, 'notes.md'), '# Notes\n\nContent');

		const ok = await deleteMemory(testDir, '-Users-craig-projects-app', 'notes.md');
		expect(ok).toBe(true);
		expect(existsSync(join(memDir, 'notes.md'))).toBe(false);
	});

	it('returns false for non-existent file', async () => {
		const memDir = join(testDir, '-Users-craig-projects-app', 'memory');
		mkdirSync(memDir, {recursive: true});

		const ok = await deleteMemory(testDir, '-Users-craig-projects-app', 'nope.md');
		expect(ok).toBe(false);
	});

	it('rejects path traversal in project param', async () => {
		const ok = await deleteMemory(testDir, '../etc', 'file.md');
		expect(ok).toBe(false);
	});

	it('rejects path traversal in filename param', async () => {
		const ok = await deleteMemory(testDir, '-Users-craig-projects-app', '../../../etc/passwd.md');
		expect(ok).toBe(false);
	});

	it('rejects slash in project param', async () => {
		const ok = await deleteMemory(testDir, 'foo/bar', 'file.md');
		expect(ok).toBe(false);
	});

	it('rejects slash in filename', async () => {
		const ok = await deleteMemory(testDir, '-Users-craig-projects-app', 'sub/file.md');
		expect(ok).toBe(false);
	});

	it('rejects non-md extension', async () => {
		const ok = await deleteMemory(testDir, '-Users-craig-projects-app', 'file.txt');
		expect(ok).toBe(false);
	});
});

describe('getProjectsDir', () => {
	it('returns path under ~/.claude/projects', () => {
		const dir = getProjectsDir();
		expect(dir).toBe(join(homedir(), '.claude', 'projects'));
	});
});
