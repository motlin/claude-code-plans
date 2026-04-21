/**
 * Pure utility functions for diff computation, language detection, and
 * line-number extraction. These are safe to import from client-side code
 * (no Shiki, no MarkdownIt, no Node.js dependencies).
 */

export type DiffOp = readonly ['equal', string] | readonly ['remove', string] | readonly ['add', string];

export interface DiffData {
	ops: DiffOp[];
	added: number;
	removed: number;
	unifiedHunk?: string | undefined;
	oldContent?: string | undefined;
	newContent?: string | undefined;
	filePath?: string | undefined;
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

/**
 * Synthesize a complete unified diff string from the Edit tool's
 * `old_string` / `new_string` fragments, in the format @git-diff-view/core
 * expects (git-style header + hunks). Line numbers are relative to the
 * fragment (starting at 1) -- not the surrounding file -- because the tool
 * payload doesn't capture the full-file context.
 */
export function buildUnifiedHunk(oldStr: string, newStr: string, filePath = 'file'): string {
	const oldLines = oldStr.split('\n');
	const newLines = newStr.split('\n');
	const ops = computeDiff(oldLines, newLines);

	const body: string[] = [];
	for (const [type, line] of ops) {
		if (type === 'equal') body.push(' ' + line);
		else if (type === 'add') body.push('+' + line);
		else body.push('-' + line);
	}

	return [
		`diff --git a/${filePath} b/${filePath}`,
		`--- a/${filePath}`,
		`+++ b/${filePath}`,
		`@@ -1,${oldLines.length} +1,${newLines.length} @@`,
		...body,
	].join('\n');
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

export function looksLikeMarkdown(text: string): boolean {
	let indicators = 0;
	if (/^#{1,6}\s/m.test(text)) indicators++;
	if (/```/.test(text)) indicators++;
	if (/^\s*[-*]\s/m.test(text)) indicators++;
	if (/\*\*[^*]+\*\*/.test(text)) indicators++;
	if (/\[[^\]]+\]\([^)]+\)/.test(text)) indicators++;
	return indicators >= 2;
}
