import {renderMarkdown, renderToolResultHtml, warmup} from '../src/lib/renderer.js';

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

describe('renderToolResultHtml', () => {
	describe('Read tool', () => {
		it('shows "Read N lines" meta text', async () => {
			const result = await renderToolResultHtml(
				'Read',
				{file_path: '/src/index.ts'},
				'     1→const x = 1;\n     2→const y = 2;',
				false,
			);
			expect(result).toContain('tool-result-meta');
			expect(result).toContain('Read 2 lines');
		});

		it('strips → line number prefixes from code content', async () => {
			const result = await renderToolResultHtml(
				'Read',
				{file_path: '/src/index.ts'},
				'     1→const x = 1;\n     2→const y = 2;',
				false,
			);
			// Shiki splits tokens into spans, so check the text isn't prefixed
			expect(result).not.toContain('1→');
			expect(result).not.toContain('2→');
			expect(result).toContain('const');
		});

		it('strips tab line number prefixes', async () => {
			const result = await renderToolResultHtml(
				'Read',
				{file_path: '/src/index.ts'},
				'     1\tconst x = 1;\n     2\tconst y = 2;',
				false,
			);
			expect(result).not.toMatch(/\d\t/);
			expect(result).toContain('const');
		});

		it('produces syntax-highlighted code for known extensions', async () => {
			const result = await renderToolResultHtml(
				'Read',
				{file_path: '/src/app.tsx'},
				'     1→export default function App() {}',
				false,
			);
			expect(result).toContain('<pre');
			expect(result).toContain('shiki');
		});

		it('renders plain code block for unknown extensions', async () => {
			const result = await renderToolResultHtml(
				'Read',
				{file_path: '/data/config.xyz'},
				'     1→some content',
				false,
			);
			expect(result).toContain('<pre');
			expect(result).toContain('some content');
		});

		it('counts lines correctly for single-line files', async () => {
			const result = await renderToolResultHtml('Read', {file_path: '/f.txt'}, '     1→hello', false);
			expect(result).toContain('Read 1 lines');
		});

		it('handles large line counts', async () => {
			const lines = Array.from({length: 150}, (_, i) => `     ${i + 1}→line ${i + 1}`).join('\n');
			const result = await renderToolResultHtml('Read', {file_path: '/big.ts'}, lines, false);
			expect(result).toContain('Read 150 lines');
		});

		it('detects python language from .py extension', async () => {
			const result = await renderToolResultHtml(
				'Read',
				{file_path: '/script.py'},
				'     1→def hello():\n     2→    pass',
				false,
			);
			expect(result).toContain('shiki');
		});

		it('detects language for all common extensions', async () => {
			const extensions = [
				'ts',
				'tsx',
				'js',
				'jsx',
				'py',
				'rb',
				'rs',
				'go',
				'java',
				'css',
				'json',
				'yaml',
				'sh',
				'sql',
			];
			for (const ext of extensions) {
				const result = await renderToolResultHtml('Read', {file_path: `/file.${ext}`}, `     1→content`, false);
				expect(result).toContain('shiki');
			}
		});
	});

	describe('Edit tool', () => {
		it('shows diff stats with +N -M format', async () => {
			const result = await renderToolResultHtml(
				'Edit',
				{file_path: '/f.ts', old_string: 'line1\nline2\nline3', new_string: 'new1\nnew2'},
				'OK',
				false,
			);
			expect(result).toContain('tool-diff-stat-added');
			expect(result).toContain('+2');
			expect(result).toContain('tool-diff-stat-removed');
			expect(result).toContain('-3');
		});

		it('renders removed lines with - marker and added lines with + marker', async () => {
			const result = await renderToolResultHtml(
				'Edit',
				{file_path: '/f.ts', old_string: 'const a = 1;', new_string: 'const a = 2;'},
				'OK',
				false,
			);
			expect(result).toContain('tool-diff-removed');
			expect(result).toContain('tool-diff-added');
			expect(result).toMatch(/>-<\/span>.*const a = 1;/s);
			expect(result).toMatch(/>\+<\/span>.*const a = 2;/s);
		});

		it('renders multi-line diffs with context lines for shared content', async () => {
			const result = await renderToolResultHtml(
				'Edit',
				{
					file_path: '/f.ts',
					old_string: 'import a from "a";\nimport b from "b";',
					new_string: 'import a from "a";\nimport b from "b";\nimport c from "c";',
				},
				'OK',
				false,
			);
			// Shared lines are context, only new line is added
			const contextCount = (result.match(/tool-diff-context/g) || []).length;
			const addedCount = (result.match(/tool-diff-added/g) || []).length;
			const removedCount = (result.match(/tool-diff-removed/g) || []).length;
			expect(contextCount).toBe(2);
			expect(addedCount).toBe(1);
			expect(removedCount).toBe(0);
		});

		it('interleaves removed and added lines at correct positions', async () => {
			const result = await renderToolResultHtml(
				'Edit',
				{
					file_path: '/f.ts',
					old_string: 'line1\nold-line\nline3',
					new_string: 'line1\nnew-line\nline3',
				},
				'OK',
				false,
			);
			// Should produce: context, removed, added, context
			const contextCount = (result.match(/tool-diff-context/g) || []).length;
			const removedCount = (result.match(/tool-diff-removed/g) || []).length;
			const addedCount = (result.match(/tool-diff-added/g) || []).length;
			expect(contextCount).toBe(2);
			expect(removedCount).toBe(1);
			expect(addedCount).toBe(1);
		});

		it('handles single-line edit', async () => {
			const result = await renderToolResultHtml(
				'Edit',
				{file_path: '/f.ts', old_string: 'old', new_string: 'new'},
				'OK',
				false,
			);
			expect(result).toContain('+1');
			expect(result).toContain('-1');
		});

		it('escapes HTML in diff content', async () => {
			const result = await renderToolResultHtml(
				'Edit',
				{file_path: '/f.tsx', old_string: '<div>old</div>', new_string: '<span>new</span>'},
				'OK',
				false,
			);
			expect(result).toContain('&lt;div&gt;old&lt;/div&gt;');
			expect(result).toContain('&lt;span&gt;new&lt;/span&gt;');
		});

		it('handles MultiEdit the same as Edit', async () => {
			const result = await renderToolResultHtml(
				'MultiEdit',
				{file_path: '/f.ts', old_string: 'a', new_string: 'b'},
				'OK',
				false,
			);
			expect(result).toContain('tool-diff');
			expect(result).toContain('tool-diff-removed');
			expect(result).toContain('tool-diff-added');
		});

		it('handles empty old_string (pure addition)', async () => {
			const result = await renderToolResultHtml(
				'Edit',
				{file_path: '/f.ts', old_string: '', new_string: 'new line'},
				'OK',
				false,
			);
			expect(result).toContain('tool-diff-added');
		});
	});

	describe('Bash tool', () => {
		it('renders output as code block', async () => {
			const result = await renderToolResultHtml('Bash', {command: 'echo hi'}, 'hi', false);
			expect(result).toContain('tool-result-content');
			expect(result).toContain('<pre');
			expect(result).toContain('hi');
		});

		it('preserves multi-line output', async () => {
			const result = await renderToolResultHtml(
				'Bash',
				{command: 'npm test'},
				'PASS src/test.ts\n  ✓ works (5ms)\nTests: 1 passed',
				false,
			);
			expect(result).toContain('PASS src/test.ts');
			expect(result).toContain('Tests: 1 passed');
		});

		it('escapes HTML in output', async () => {
			const result = await renderToolResultHtml(
				'Bash',
				{command: 'echo test'},
				'<script>alert("xss")</script>',
				false,
			);
			expect(result).not.toContain('<script>alert');
		});
	});

	describe('Write tool', () => {
		it('shows confirmation message as meta text', async () => {
			const result = await renderToolResultHtml(
				'Write',
				{file_path: '/src/new-file.ts', content: 'hello'},
				'File created successfully at: /src/new-file.ts',
				false,
			);
			expect(result).toContain('tool-result-meta');
			expect(result).toContain('File created successfully');
		});
	});

	describe('Glob tool', () => {
		it('shows file count meta', async () => {
			const result = await renderToolResultHtml(
				'Glob',
				{pattern: '**/*.ts'},
				'src/a.ts\nsrc/b.ts\nsrc/c.ts',
				false,
			);
			expect(result).toContain('3 files');
		});

		it('renders file list in pre block', async () => {
			const result = await renderToolResultHtml('Glob', {pattern: '**/*.ts'}, 'src/a.ts\nsrc/b.ts', false);
			expect(result).toContain('<pre');
			expect(result).toContain('src/a.ts');
		});

		it('handles empty results', async () => {
			const result = await renderToolResultHtml('Glob', {pattern: '**/*.xyz'}, '', false);
			expect(result).toContain('0 files');
		});
	});

	describe('Grep tool', () => {
		it('renders matches in code block', async () => {
			const result = await renderToolResultHtml(
				'Grep',
				{pattern: 'error'},
				'src/a.ts:5: throw new Error("bad")\nsrc/b.ts:12: console.error("fail")',
				false,
			);
			expect(result).toContain('<pre');
			expect(result).toContain('Error');
		});
	});

	describe('error handling', () => {
		it('error results get tool-result-error class', async () => {
			const result = await renderToolResultHtml('Bash', {command: 'bad-cmd'}, 'command not found: bad-cmd', true);
			expect(result).toContain('tool-result-error');
		});

		it('error class applied to Read errors', async () => {
			const result = await renderToolResultHtml(
				'Read',
				{file_path: '/nonexistent.ts'},
				'File does not exist.',
				true,
			);
			expect(result).toContain('tool-result-error');
			expect(result).toContain('File does not exist.');
		});

		it('error class wraps the entire tool-result div', async () => {
			const result = await renderToolResultHtml('Bash', {command: 'fail'}, 'error', true);
			expect(result).toMatch(/<div class="tool-result tool-result-error">/);
		});
	});

	describe('unknown tools', () => {
		it('render raw text in pre block', async () => {
			const result = await renderToolResultHtml('CustomTool', {foo: 'bar'}, 'some output', false);
			expect(result).toContain('<pre');
			expect(result).toContain('some output');
		});

		it('escape HTML in output', async () => {
			const result = await renderToolResultHtml('Unknown', {}, '<b>bold</b>', false);
			expect(result).toContain('&lt;b&gt;bold&lt;/b&gt;');
		});
	});

	describe('empty results', () => {
		it('renders empty Read result without crashing', async () => {
			const result = await renderToolResultHtml('Read', {file_path: '/f.ts'}, '', false);
			expect(result).toContain('tool-result');
			expect(result).toContain('Read 0 lines');
		});

		it('renders empty Bash result', async () => {
			const result = await renderToolResultHtml('Bash', {command: 'true'}, '', false);
			expect(result).toContain('tool-result');
		});

		it('renders empty Glob result', async () => {
			const result = await renderToolResultHtml('Glob', {pattern: '**/*.xyz'}, '', false);
			expect(result).toContain('0 files');
		});
	});

	describe('MCP tools', () => {
		it('renders MCP tool output as plain pre block', async () => {
			const result = await renderToolResultHtml(
				'mcp__chrome-devtools__list_pages',
				{},
				'[{"url":"http://localhost:3000"}]',
				false,
			);
			expect(result).toContain('<pre');
			expect(result).toContain('localhost:3000');
		});

		it('escapes HTML in MCP tool output', async () => {
			const result = await renderToolResultHtml(
				'mcp__gmail__read_email',
				{},
				'<html><body>email</body></html>',
				false,
			);
			expect(result).toContain('&lt;html&gt;');
			expect(result).not.toContain('<html>');
		});
	});

	describe('TodoWrite tool', () => {
		it('renders as plain pre block', async () => {
			const result = await renderToolResultHtml(
				'TodoWrite',
				{todos: [{content: 'task', status: 'pending'}]},
				'Todos updated',
				false,
			);
			expect(result).toContain('<pre');
			expect(result).toContain('Todos updated');
		});
	});

	describe('Edit with empty strings', () => {
		it('handles empty new_string (pure deletion)', async () => {
			const result = await renderToolResultHtml(
				'Edit',
				{file_path: '/f.ts', old_string: 'deleted line', new_string: ''},
				'OK',
				false,
			);
			expect(result).toContain('tool-diff-removed');
			expect(result).toContain('-1');
		});

		it('handles both strings empty', async () => {
			const result = await renderToolResultHtml(
				'Edit',
				{file_path: '/f.ts', old_string: '', new_string: ''},
				'OK',
				false,
			);
			expect(result).toContain('tool-result');
		});
	});

	describe('Read edge cases', () => {
		it('handles empty file content', async () => {
			const result = await renderToolResultHtml('Read', {file_path: '/empty.ts'}, '', false);
			expect(result).toContain('Read 0 lines');
		});

		it('handles file path with special characters', async () => {
			const result = await renderToolResultHtml(
				'Read',
				{file_path: '/path/with spaces/file (1).ts'},
				'     1→const x = 1;',
				false,
			);
			expect(result).toContain('Read 1 lines');
		});

		it('handles Dockerfile without extension', async () => {
			const result = await renderToolResultHtml(
				'Read',
				{file_path: '/app/Dockerfile'},
				'     1→FROM node:18',
				false,
			);
			expect(result).toContain('<pre');
			expect(result).toContain('FROM node');
		});
	});

	describe('Bash edge cases', () => {
		it('handles very long single-line output', async () => {
			const longLine = 'x'.repeat(5000);
			const result = await renderToolResultHtml('Bash', {command: 'echo long'}, longLine, false);
			expect(result).toContain('tool-result-content');
		});

		it('handles ANSI escape codes in output', async () => {
			const result = await renderToolResultHtml('Bash', {command: 'ls --color'}, '\x1b[32mfile.ts\x1b[0m', false);
			expect(result).toContain('tool-result-content');
		});
	});

	describe('HTML escaping', () => {
		it('escapes diff content', async () => {
			const result = await renderToolResultHtml(
				'Edit',
				{file_path: '/f.tsx', old_string: '<div>old</div>', new_string: '<span>new</span>'},
				'OK',
				false,
			);
			expect(result).toContain('&lt;div&gt;');
			expect(result).toContain('&lt;span&gt;');
			expect(result).not.toContain('<div>old</div>');
		});

		it('escapes Write result text', async () => {
			const result = await renderToolResultHtml(
				'Write',
				{file_path: '/f.ts'},
				'Created <script>alert(1)</script>',
				false,
			);
			expect(result).toContain('&lt;script&gt;');
			expect(result).not.toContain('<script>alert');
		});

		it('escapes unknown tool output', async () => {
			const result = await renderToolResultHtml('Unknown', {}, '<img onerror=alert(1)>', false);
			expect(result).toContain('&lt;img');
			expect(result).not.toContain('<img');
		});
	});
});
