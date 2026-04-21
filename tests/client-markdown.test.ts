import {renderMarkdownToHtml} from '../src/lib/client-markdown';

describe('renderMarkdownToHtml', () => {
	it('renders markdown headings to HTML', () => {
		const result = renderMarkdownToHtml('# Hello');
		expect(result).toContain('<h1>Hello</h1>');
	});

	it('renders empty/whitespace-only input as empty string', () => {
		expect(renderMarkdownToHtml('')).toBe('');
		expect(renderMarkdownToHtml('   ')).toBe('');
		expect(renderMarkdownToHtml('\n')).toBe('');
	});

	it('renders inline formatting', () => {
		const result = renderMarkdownToHtml('**bold** and *italic*');
		expect(result).toContain('<strong>bold</strong>');
		expect(result).toContain('<em>italic</em>');
	});

	it('renders code blocks with pre/code tags', () => {
		const result = renderMarkdownToHtml('```js\nconst x = 1;\n```');
		expect(result).toContain('<pre>');
		expect(result).toContain('<code');
		expect(result).toContain('const x = 1;');
	});

	it('renders task lists via markdown-it-task-lists plugin', () => {
		const result = renderMarkdownToHtml('- [ ] unchecked\n- [x] checked');
		expect(result).toContain('type="checkbox"');
		expect(result).toContain('checked');
	});

	it('renders footnotes via markdown-it-footnote plugin', () => {
		const result = renderMarkdownToHtml('Text[^1]\n\n[^1]: Footnote content');
		expect(result).toContain('footnote');
	});

	it('linkifies URLs', () => {
		const result = renderMarkdownToHtml('Visit https://example.com today');
		expect(result).toContain('href="https://example.com"');
	});

	it('returns the same instance on repeated calls (singleton)', () => {
		const result1 = renderMarkdownToHtml('# Test');
		const result2 = renderMarkdownToHtml('# Test');
		expect(result1).toBe(result2);
	});
});
