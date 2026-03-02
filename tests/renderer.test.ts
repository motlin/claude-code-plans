import {renderMarkdown} from '../src/renderer.js';

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
});
