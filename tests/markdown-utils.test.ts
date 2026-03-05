import {writeFileSync, mkdirSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {humanizeFilename, extractTitleFromContent, extractTitle} from '../src/markdown-utils.js';

const testDir = join(tmpdir(), 'claude-md-utils-test-' + process.pid);

beforeEach(() => {
	mkdirSync(testDir, {recursive: true});
});

afterEach(() => {
	rmSync(testDir, {recursive: true, force: true});
});

describe('humanizeFilename', () => {
	it('converts dashes and underscores to title case', () => {
		expect(humanizeFilename('my-cool-plan.md')).toBe('My Cool Plan');
	});

	it('strips .md extension', () => {
		expect(humanizeFilename('readme.md')).toBe('Readme');
	});
});

describe('extractTitleFromContent', () => {
	it('extracts title from # heading', () => {
		expect(extractTitleFromContent('# My Title\n\nContent', 'file.md')).toBe('My Title');
	});

	it('falls back to humanized filename', () => {
		expect(extractTitleFromContent('No heading here', 'my-file.md')).toBe('My File');
	});

	it('falls back for empty content', () => {
		expect(extractTitleFromContent('', 'fallback.md')).toBe('Fallback');
	});
});

describe('extractTitle', () => {
	it('reads title from file', async () => {
		writeFileSync(join(testDir, 'test.md'), '# From File\n\nBody');
		const title = await extractTitle(join(testDir, 'test.md'), 'test.md');
		expect(title).toBe('From File');
	});

	it('falls back for non-existent file', async () => {
		const title = await extractTitle(join(testDir, 'nope.md'), 'some-plan.md');
		expect(title).toBe('Some Plan');
	});
});
