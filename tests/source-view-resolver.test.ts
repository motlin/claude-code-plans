import {writeFileSync, mkdirSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {
	resolveSourcePath,
	readSourceFile,
	buildSourceConfig,
	isValidSourceKind,
	type SourceKindConfig,
} from '../src/lib/source-view.js';

const testRoot = join(tmpdir(), 'claude-source-view-test-' + process.pid);

const mdConfig: SourceKindConfig = {
	root: testRoot,
	extension: '.md',
	language: 'markdown',
};

const jsonConfig: SourceKindConfig = {
	root: testRoot,
	extension: '.json',
	language: 'json',
};

beforeEach(() => {
	mkdirSync(testRoot, {recursive: true});
});

afterEach(() => {
	rmSync(testRoot, {recursive: true, force: true});
});

describe('resolveSourcePath', () => {
	it('resolves a single-level filename inside root', () => {
		const result = resolveSourcePath(mdConfig, 'plan.md');
		expect(result).toBe(join(testRoot, 'plan.md'));
	});

	it('resolves nested paths inside root', () => {
		const result = resolveSourcePath(jsonConfig, 'project-a/42.json');
		expect(result).toBe(join(testRoot, 'project-a', '42.json'));
	});

	it('rejects empty string', () => {
		expect(resolveSourcePath(mdConfig, '')).toBe(null);
	});

	it('rejects path traversal with ..', () => {
		expect(resolveSourcePath(mdConfig, '../etc/passwd.md')).toBe(null);
	});

	it('rejects nested path traversal', () => {
		expect(resolveSourcePath(mdConfig, 'sub/../../etc/passwd.md')).toBe(null);
	});

	it('rejects absolute paths', () => {
		expect(resolveSourcePath(mdConfig, '/etc/passwd.md')).toBe(null);
	});

	it('rejects wrong extension', () => {
		expect(resolveSourcePath(mdConfig, 'note.txt')).toBe(null);
		expect(resolveSourcePath(jsonConfig, 'note.md')).toBe(null);
	});

	it('rejects empty path segments', () => {
		expect(resolveSourcePath(mdConfig, 'sub//file.md')).toBe(null);
	});

	it('rejects "." segments', () => {
		expect(resolveSourcePath(mdConfig, './file.md')).toBe(null);
	});
});

describe('readSourceFile', () => {
	it('reads a markdown file', async () => {
		writeFileSync(join(testRoot, 'plan.md'), '# Hello\n');
		const file = await readSourceFile('plan', mdConfig, 'plan.md');
		if (!file) throw new Error('Expected non-null file');
		expect(file.mtime).toBeInstanceOf(Date);
		const {mtime: _mtime, ...rest} = file;
		expect(rest).toStrictEqual({
			kind: 'plan',
			absolutePath: join(testRoot, 'plan.md'),
			content: '# Hello\n',
			language: 'markdown',
			relativePath: 'plan.md',
		});
	});

	it('reads a JSON task file', async () => {
		mkdirSync(join(testRoot, 'proj'));
		writeFileSync(join(testRoot, 'proj', '1.json'), '{"id":"1"}');
		const file = await readSourceFile('task', jsonConfig, 'proj/1.json');
		if (!file) throw new Error('Expected non-null file');
		expect(file.mtime).toBeInstanceOf(Date);
		const {mtime: _mtime2, ...rest} = file;
		expect(rest).toStrictEqual({
			kind: 'task',
			absolutePath: join(testRoot, 'proj', '1.json'),
			content: '{"id":"1"}',
			language: 'json',
			relativePath: 'proj/1.json',
		});
	});

	it('returns null for non-existent file', async () => {
		expect(await readSourceFile('plan', mdConfig, 'missing.md')).toBe(null);
	});

	it('returns null for traversal attempts', async () => {
		expect(await readSourceFile('plan', mdConfig, '../etc/passwd.md')).toBe(null);
	});

	it('returns null for wrong extension', async () => {
		writeFileSync(join(testRoot, 'evil.txt'), 'bad');
		expect(await readSourceFile('plan', mdConfig, 'evil.txt')).toBe(null);
	});
});

describe('buildSourceConfig', () => {
	it('returns plans config for kind=plan', () => {
		const cfg = buildSourceConfig('plan', '/home/u/.claude');
		expect(cfg).toStrictEqual({root: '/home/u/.claude/plans', extension: '.md', language: 'markdown'});
	});

	it('returns memory config for kind=memory', () => {
		const cfg = buildSourceConfig('memory', '/home/u/.claude');
		expect(cfg).toStrictEqual({root: '/home/u/.claude/projects', extension: '.md', language: 'markdown'});
	});

	it('returns tasks config for kind=task', () => {
		const cfg = buildSourceConfig('task', '/home/u/.claude');
		expect(cfg).toStrictEqual({root: '/home/u/.claude/tasks', extension: '.json', language: 'json'});
	});

	it('returns null for kind=command', () => {
		expect(buildSourceConfig('command', '/home/u/.claude')).toBe(null);
	});
});

describe('isValidSourceKind', () => {
	it('accepts known kinds', () => {
		expect(isValidSourceKind('plan')).toBe(true);
		expect(isValidSourceKind('memory')).toBe(true);
		expect(isValidSourceKind('task')).toBe(true);
		expect(isValidSourceKind('command')).toBe(true);
	});

	it('rejects unknown kinds', () => {
		expect(isValidSourceKind('session')).toBe(false);
		expect(isValidSourceKind('')).toBe(false);
		expect(isValidSourceKind('plans')).toBe(false);
	});
});
