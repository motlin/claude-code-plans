import MarkdownIt from 'markdown-it';
import Shiki from '@shikijs/markdown-it';
import taskLists from 'markdown-it-task-lists';
import footnote from 'markdown-it-footnote';
import {claudeLight} from './claude-light-theme';

let md: MarkdownIt | null = null;

async function getMd(): Promise<MarkdownIt> {
	if (md) return md;
	md = MarkdownIt({html: true, linkify: true});
	md.use(taskLists);
	md.use(footnote);
	md.use(
		await Shiki({
			themes: {
				light: claudeLight,
				dark: 'github-dark',
			},
		}),
	);

	// Wrap the highlight function to extract line numbers from Read tool prefixes
	// and enable line number rendering in the output
	const originalHighlight = md.options.highlight;
	md.options.highlight = (code: string, lang: string, attrs: string) => {
		// Extract line numbers from Read tool prefixes
		const {text: cleanCode, startLine, hasLineNumbers} = extractLineNumbers(code);

		// Call original highlight function with clean code
		if (originalHighlight) {
			try {
				const result = originalHighlight(cleanCode, lang, attrs);

				// If line numbers were detected in the original code,
				// enhance the output to include line numbers as a gutter.
				if (hasLineNumbers) {
					// Post-process the HTML to add line numbers before each line
					return enhanceWithLineNumbers(result, startLine);
				}

				return result;
			} catch {
				// Language not supported by Shiki — fall through to plain text
			}
		}
		// Fallback: plain escaped text
		const escaped = cleanCode.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		return `<pre class="shiki" style="overflow-x:auto"><code>${escaped}</code></pre>`;
	};

	return md;
}

/**
 * Enhances Shiki-generated HTML with line number gutters.
 * Finds each <span class="line">...</span> and prepends a line number.
 */
function enhanceWithLineNumbers(html: string, startLine: number): string {
	// Pattern to match individual line spans
	const linePattern = /(<span class="line">)/g;
	let lineNum = startLine;

	const enhanced = html.replace(linePattern, () => {
		const lineNumberHtml = `<span class="shiki-line-number" data-line="${lineNum}" style="display: inline-block; width: 3em; margin-right: 0.5em; text-align: right; color: #999; user-select: none;">${lineNum}</span>`;
		const result = lineNumberHtml + `<span class="line">`;
		lineNum++;
		return result;
	});

	return enhanced;
}

export async function warmup(): Promise<void> {
	await getMd();
}

export function looksLikeMarkdown(text: string): boolean {
	let indicators = 0;
	if (/^#{1,6}\s/m.test(text)) indicators++;
	if (/```/.test(text)) indicators++;
	if (/^\s*[-*]\s/m.test(text)) indicators++;
	if (/\*\*[^*]+\*\*/.test(text)) indicators++;
	if (/\[[^\]]+\]\([^)]+\)/.test(text)) indicators++;
	return indicators >= 2;
}

export async function renderMarkdown(markdown: string): Promise<string> {
	if (!markdown.trim()) return '';
	const instance = await getMd();
	return instance.render(markdown);
}

export async function renderInlineMarkdown(text: string): Promise<string> {
	if (!text.trim()) return '';
	const instance = await getMd();
	return instance.renderInline(text);
}

const EXT_LANG: Record<string, string> = {
	ts: 'typescript',
	tsx: 'tsx',
	js: 'javascript',
	jsx: 'jsx',
	py: 'python',
	rb: 'ruby',
	rs: 'rust',
	go: 'go',
	java: 'java',
	kt: 'kotlin',
	swift: 'swift',
	c: 'c',
	cpp: 'cpp',
	h: 'c',
	hpp: 'cpp',
	cs: 'csharp',
	css: 'css',
	scss: 'scss',
	html: 'html',
	xml: 'xml',
	json: 'json',
	yaml: 'yaml',
	yml: 'yaml',
	toml: 'toml',
	md: 'markdown',
	sh: 'sh',
	bash: 'bash',
	zsh: 'sh',
	sql: 'sql',
	graphql: 'graphql',
	vue: 'vue',
	svelte: 'svelte',
};

export function detectLanguage(filePath: string): string {
	const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
	return EXT_LANG[ext] ?? '';
}

/**
 * Extracts line numbers from Read tool prefixes (e.g., "1→content" -> {content: "content", lineNumber: 1})
 * and removes the prefix from the line.
 * Returns {text, startLine, hasLineNumbers} where:
 * - text: the code without line number prefixes
 * - startLine: the starting line number (or 1 if not found)
 * - hasLineNumbers: whether line numbers were detected in the original text
 */
export function extractLineNumbers(text: string): {text: string; startLine: number; hasLineNumbers: boolean} {
	const lines = text.split('\n');
	let startLine = 1;
	let hasLineNumbers = false;

	const processedLines = lines.map((line, index) => {
		// Match line number prefix patterns: "  1→" or "1→" or "1\t"
		const match = line.match(/^\s*(\d+)[→\t]/);
		if (match) {
			hasLineNumbers = true;
			if (index === 0) {
				startLine = parseInt(match[1]!, 10);
			}
			// Remove the prefix and preserve the rest of the line
			return line.replace(/^\s*\d+[→\t]/, '');
		}
		return line;
	});

	return {
		text: processedLines.join('\n'),
		startLine: hasLineNumbers ? startLine : 1,
		hasLineNumbers,
	};
}

/**
 * Legacy function for backwards compatibility.
 * Strips line number prefixes without preserving line number information.
 */
export function stripLineNumberPrefixes(text: string): string {
	const {text: cleanText} = extractLineNumbers(text);
	return cleanText;
}

export async function highlightCode(code: string, lang: string): Promise<string> {
	const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	if (!lang) {
		return `<pre class="shiki" style="overflow-x:auto"><code>${escaped}</code></pre>`;
	}
	try {
		const fence = '```' + lang + '\n' + code + '\n```';
		const instance = await getMd();
		return instance.render(fence);
	} catch {
		return `<pre class="shiki" style="overflow-x:auto"><code>${escaped}</code></pre>`;
	}
}

export type DiffOp = readonly ['equal', string] | readonly ['remove', string] | readonly ['add', string];

/**
 * Highlights diff ops using Shiki syntax highlighting.
 * Combines all lines into a single code block for correct tokenization,
 * then splits the result back into per-line HTML strings.
 * Returns an array of HTML strings (one per op), containing only the
 * inner token spans (no wrapping pre/code tags).
 */
export async function highlightDiffOps(ops: readonly DiffOp[], lang: string): Promise<string[]> {
	if (ops.length === 0) return [];

	const lines = ops.map(([, line]) => line);
	const combined = lines.join('\n');

	if (!lang) {
		// Return plain escaped HTML per line
		return lines.map((line) => line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
	}

	const highlighted = await highlightCode(combined, lang);

	// Extract the inner content of <span class="line">...</span> elements
	const lineRegex = /<span class="line">(.*?)<\/span>/g;
	const htmlLines: string[] = [];
	let match: RegExpExecArray | null;
	while ((match = lineRegex.exec(highlighted)) !== null) {
		htmlLines.push(match[1] ?? '');
	}

	// If extraction failed or counts don't match, fall back to plain escaped text
	if (htmlLines.length !== ops.length) {
		return lines.map((line) => line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
	}

	return htmlLines;
}

export interface DiffData {
	ops: DiffOp[];
	added: number;
	removed: number;
	highlightedLines?: string[] | undefined;
}

function computeDiff(oldLines: string[], newLines: string[]): DiffOp[] {
	const m = oldLines.length;
	const n = newLines.length;

	// LCS via dynamic programming
	const dp: number[][] = Array.from({length: m + 1}, () => new Array(n + 1).fill(0));
	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			if (oldLines[i - 1] === newLines[j - 1]) {
				dp[i]![j] = dp[i - 1]![j - 1]! + 1;
			} else {
				dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
			}
		}
	}

	// Backtrack to produce diff ops
	const ops: DiffOp[] = [];
	let i = m;
	let j = n;
	while (i > 0 || j > 0) {
		if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
			ops.push(['equal', oldLines[i - 1]!]);
			i--;
			j--;
		} else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
			ops.push(['add', newLines[j - 1]!]);
			j--;
		} else {
			ops.push(['remove', oldLines[i - 1]!]);
			i--;
		}
	}
	ops.reverse();
	return ops;
}

export function computeDiffData(oldStr: string, newStr: string): DiffData {
	const ops = computeDiff(oldStr.split('\n'), newStr.split('\n'));
	let added = 0;
	let removed = 0;
	for (const [type] of ops) {
		if (type === 'add') added++;
		else if (type === 'remove') removed++;
	}
	return {ops, added, removed};
}
