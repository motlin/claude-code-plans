import {renderMarkdown, computeDiffData, warmup} from '../src/lib/renderer.js';

beforeAll(async () => {
	await warmup();
});

describe('renderMarkdown', () => {
	it('renders headings', async () => {
		const result = await renderMarkdown('# Hello World');
		expect(result).toContain('<h1>Hello World</h1>');
	});

	it('renders h2 headings', async () => {
		const result = await renderMarkdown('## Section');
		expect(result).toContain('<h2>Section</h2>');
	});

	it('renders code blocks with shiki highlighting', async () => {
		const input = '```typescript\nconst x = 1;\n```';
		const result = await renderMarkdown(input);
		expect(result).toContain('<pre');
		expect(result).toContain('shiki');
		expect(result).toContain('const');
	});

	it('renders GFM tables', async () => {
		const input = '| A | B |\n|---|---|\n| 1 | 2 |';
		const result = await renderMarkdown(input);
		expect(result).toContain('<table>');
		expect(result).toContain('<th>');
		expect(result).toContain('<td>');
	});

	it('renders bold text', async () => {
		const result = await renderMarkdown('**bold**');
		expect(result).toContain('<strong>bold</strong>');
	});

	it('renders links', async () => {
		const result = await renderMarkdown('[link](https://example.com)');
		expect(result).toContain('<a href="https://example.com">link</a>');
	});

	it('renders empty input', async () => {
		const result = await renderMarkdown('');
		expect(result).toBe('');
	});

	it('renders inline code', async () => {
		const result = await renderMarkdown('use `npm install`');
		expect(result).toContain('<code>npm install</code>');
	});

	it('renders unordered lists', async () => {
		const input = '- item 1\n- item 2';
		const result = await renderMarkdown(input);
		expect(result).toContain('<ul>');
		expect(result).toContain('<li>');
	});

	it('renders ordered lists', async () => {
		const input = '1. first\n2. second';
		const result = await renderMarkdown(input);
		expect(result).toContain('<ol>');
		expect(result).toContain('<li>');
	});

	it('renders code blocks with dual theme shiki variables', async () => {
		const input = '```typescript\nconst x = 1;\n```';
		const result = await renderMarkdown(input);
		expect(result).toContain('--shiki-dark');
	});
});

describe('computeDiffData', () => {
	it('counts added and removed lines', () => {
		const result = computeDiffData('line1\nline2\nline3', 'new1\nnew2');
		expect(result.added).toBe(2);
		expect(result.removed).toBe(3);
	});

	it('identifies context lines for shared content', () => {
		const result = computeDiffData(
			'import a from "a";\nimport b from "b";',
			'import a from "a";\nimport b from "b";\nimport c from "c";',
		);
		const contextCount = result.ops.filter(([type]) => type === 'equal').length;
		const addedCount = result.ops.filter(([type]) => type === 'add').length;
		expect(contextCount).toBe(2);
		expect(addedCount).toBe(1);
		expect(result.added).toBe(1);
		expect(result.removed).toBe(0);
	});

	it('handles single-line edits', () => {
		const result = computeDiffData('old', 'new');
		expect(result.added).toBe(1);
		expect(result.removed).toBe(1);
	});

	it('handles pure addition (empty old string)', () => {
		const result = computeDiffData('', 'new line');
		expect(result.added).toBeGreaterThanOrEqual(1);
	});

	it('handles pure deletion (empty new string)', () => {
		const result = computeDiffData('deleted line', '');
		expect(result.removed).toBeGreaterThanOrEqual(1);
	});

	it('handles both strings empty', () => {
		const result = computeDiffData('', '');
		expect(result.added).toBe(0);
		expect(result.removed).toBe(0);
		expect(result.ops).toHaveLength(1); // one equal empty string
	});

	it('interleaves removed and added lines correctly', () => {
		const result = computeDiffData('line1\nold-line\nline3', 'line1\nnew-line\nline3');
		const contextCount = result.ops.filter(([type]) => type === 'equal').length;
		const removedCount = result.ops.filter(([type]) => type === 'remove').length;
		const addedCount = result.ops.filter(([type]) => type === 'add').length;
		expect(contextCount).toBe(2);
		expect(removedCount).toBe(1);
		expect(addedCount).toBe(1);
	});

	it('returns ops in correct order', () => {
		const result = computeDiffData('a\nb', 'a\nc');
		expect(result.ops[0]).toEqual(['equal', 'a']);
		expect(result.ops[1]).toEqual(['remove', 'b']);
		expect(result.ops[2]).toEqual(['add', 'c']);
	});
});
