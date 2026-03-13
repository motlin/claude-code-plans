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

export function detectLanguage(filePath: string): string {
	const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
	return EXT_LANG[ext] ?? '';
}

export function stripLineNumberPrefixes(text: string): string {
	return text
		.split('\n')
		.map((line) => line.replace(/^\s*\d+[→\t]/, ''))
		.join('\n');
}

export type DiffOp = readonly ['equal', string] | readonly ['remove', string] | readonly ['add', string];

export interface DiffData {
	ops: DiffOp[];
	added: number;
	removed: number;
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
