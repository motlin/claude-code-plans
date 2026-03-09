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
	return md;
}

export async function warmup(): Promise<void> {
	await getMd();
}

export async function renderMarkdown(markdown: string): Promise<string> {
	if (!markdown.trim()) return '';
	const instance = await getMd();
	return instance.render(markdown);
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

function detectLanguage(filePath: string): string {
	const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
	return EXT_LANG[ext] ?? '';
}

function stripLineNumberPrefixes(text: string): string {
	return text
		.split('\n')
		.map((line) => line.replace(/^\s*\d+[→\t]/, ''))
		.join('\n');
}

function escapeHtml(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function countLines(text: string): number {
	if (!text) return 0;
	return text.split('\n').length;
}

type DiffOp = ['equal', string] | ['remove', string] | ['add', string];

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

function buildDiffHtml(oldStr: string, newStr: string): string {
	const oldLines = oldStr.split('\n');
	const newLines = newStr.split('\n');
	const ops = computeDiff(oldLines, newLines);
	const rows: string[] = [];

	for (const [type, line] of ops) {
		if (type === 'equal') {
			rows.push(
				`<div class="tool-diff-context"><span class="tool-diff-marker"> </span><span class="tool-diff-code">${escapeHtml(line)}</span></div>`,
			);
		} else if (type === 'remove') {
			rows.push(
				`<div class="tool-diff-removed"><span class="tool-diff-marker">-</span><span class="tool-diff-code">${escapeHtml(line)}</span></div>`,
			);
		} else {
			rows.push(
				`<div class="tool-diff-added"><span class="tool-diff-marker">+</span><span class="tool-diff-code">${escapeHtml(line)}</span></div>`,
			);
		}
	}
	return `<div class="tool-diff">${rows.join('')}</div>`;
}

function diffStats(oldStr: string, newStr: string): string {
	const ops = computeDiff(oldStr.split('\n'), newStr.split('\n'));
	let added = 0;
	let removed = 0;
	for (const [type] of ops) {
		if (type === 'add') added++;
		else if (type === 'remove') removed++;
	}
	const parts: string[] = [];
	if (added > 0) parts.push(`<span class="tool-diff-stat-added">+${added}</span>`);
	if (removed > 0) parts.push(`<span class="tool-diff-stat-removed">-${removed}</span>`);
	return parts.join(' ');
}

export async function renderToolResultHtml(
	name: string,
	input: Record<string, unknown>,
	result: string,
	isError: boolean,
): Promise<string> {
	const errorClass = isError ? ' tool-result-error' : '';
	const wrap = (body: string) => `<div class="tool-result${errorClass}">${body}</div>`;

	switch (name) {
		case 'Read': {
			const filePath = (input['file_path'] as string) ?? '';
			const lineCount = countLines(result);
			const lang = detectLanguage(filePath);
			const code = stripLineNumberPrefixes(result);
			const fence = lang ? `\`\`\`${lang}\n${code}\n\`\`\`` : `\`\`\`\n${code}\n\`\`\``;
			const rendered = await renderMarkdown(fence);
			return wrap(
				`<div class="tool-result-meta">Read ${lineCount} lines</div>` +
					`<div class="tool-result-content">${rendered}</div>`,
			);
		}
		case 'Edit':
		case 'MultiEdit': {
			const oldStr = (input['old_string'] as string) ?? '';
			const newStr = (input['new_string'] as string) ?? '';
			const stats = diffStats(oldStr, newStr);
			const diff = buildDiffHtml(oldStr, newStr);
			return wrap(
				`<div class="tool-result-summary"><span class="tool-diff-stats">${stats}</span></div>` +
					`<div class="tool-result-content">${diff}</div>`,
			);
		}
		case 'Write': {
			return wrap(`<div class="tool-result-meta">${escapeHtml(result)}</div>`);
		}
		case 'Bash': {
			const fence = `\`\`\`\n${result}\n\`\`\``;
			const rendered = await renderMarkdown(fence);
			return wrap(`<div class="tool-result-content">${rendered}</div>`);
		}
		case 'Glob': {
			const fileCount = result.trim() ? result.trim().split('\n').length : 0;
			return wrap(
				`<div class="tool-result-meta">${fileCount} files</div>` +
					`<pre class="tool-result-pre">${escapeHtml(result)}</pre>`,
			);
		}
		case 'Grep': {
			const fence = `\`\`\`\n${result}\n\`\`\``;
			const rendered = await renderMarkdown(fence);
			return wrap(`<div class="tool-result-content">${rendered}</div>`);
		}
		default: {
			return wrap(`<pre class="tool-result-pre">${escapeHtml(result)}</pre>`);
		}
	}
}
