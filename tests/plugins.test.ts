import {writeFileSync, mkdirSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {parseFrontmatter, readPluginFileContent, readUserCommandContent} from '../src/lib/plugins.js';

const testDir = join(tmpdir(), 'claude-plugins-test-' + process.pid);

beforeEach(() => {
	mkdirSync(testDir, {recursive: true});
});

afterEach(() => {
	rmSync(testDir, {recursive: true, force: true});
});

describe('parseFrontmatter', () => {
	it('parses YAML frontmatter from content', () => {
		const content = '---\nname: test-agent\ndescription: A test agent\nmodel: sonnet\n---\n\n# Body';
		const {frontmatter, body} = parseFrontmatter(content);
		expect(frontmatter['name']).toBe('test-agent');
		expect(frontmatter['description']).toBe('A test agent');
		expect(frontmatter['model']).toBe('sonnet');
		expect(body).toBe('# Body');
	});

	it('returns empty frontmatter when no delimiters', () => {
		const content = '# Just markdown\n\nNo frontmatter here.';
		const {frontmatter, body} = parseFrontmatter(content);
		expect(frontmatter).toEqual({});
		expect(body).toBe(content);
	});

	it('returns empty frontmatter when no closing delimiter', () => {
		const content = '---\nname: broken\nNo closing delimiter';
		const {frontmatter, body} = parseFrontmatter(content);
		expect(frontmatter).toEqual({});
		expect(body).toBe(content);
	});

	it('handles empty frontmatter block', () => {
		const content = '---\n---\n\n# Body';
		const {frontmatter, body} = parseFrontmatter(content);
		expect(frontmatter).toEqual({});
		expect(body).toBe('# Body');
	});

	it('handles values with colons', () => {
		const content = '---\ndescription: Use this when: the user asks\n---\n\nBody';
		const {frontmatter, body} = parseFrontmatter(content);
		expect(frontmatter['description']).toBe('Use this when: the user asks');
		expect(body).toBe('Body');
	});

	it('skips lines without colons', () => {
		const content = '---\nname: test\njust a line\nversion: 1.0\n---\n\nBody';
		const {frontmatter} = parseFrontmatter(content);
		expect(frontmatter['name']).toBe('test');
		expect(frontmatter['version']).toBe('1.0');
		expect(Object.keys(frontmatter)).toHaveLength(2);
	});
});

describe('readPluginFileContent', () => {
	it('reads a file from an install path', async () => {
		const agentsDir = join(testDir, 'agents');
		mkdirSync(agentsDir, {recursive: true});
		writeFileSync(join(agentsDir, 'test.md'), '# Test Agent');

		const content = await readPluginFileContent(testDir, 'agents', 'test.md');
		expect(content).toBe('# Test Agent');
	});

	it('returns null for non-existent file', async () => {
		const content = await readPluginFileContent(testDir, 'agents', 'nope.md');
		expect(content).toBeNull();
	});

	it('rejects path traversal', async () => {
		const content = await readPluginFileContent(testDir, '..', 'etc', 'passwd');
		expect(content).toBeNull();
	});

	it('reads nested skill files', async () => {
		const skillDir = join(testDir, 'skills', 'my-skill', 'references');
		mkdirSync(skillDir, {recursive: true});
		writeFileSync(join(skillDir, 'ref.md'), '# Reference');

		const content = await readPluginFileContent(testDir, 'skills', 'my-skill', 'references', 'ref.md');
		expect(content).toBe('# Reference');
	});
});

describe('readUserCommandContent', () => {
	it('rejects path traversal in filename', async () => {
		const content = await readUserCommandContent('global', '../evil.md');
		expect(content).toBeNull();
	});

	it('rejects filenames with slashes', async () => {
		const content = await readUserCommandContent('global', 'sub/file.md');
		expect(content).toBeNull();
	});

	it('rejects non-md extension', async () => {
		const content = await readUserCommandContent('global', 'file.txt');
		expect(content).toBeNull();
	});

	it('rejects path traversal in source', async () => {
		const content = await readUserCommandContent('../evil', 'test.md');
		expect(content).toBeNull();
	});
});
