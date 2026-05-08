/**
 * Server-side rendering utilities (Shiki syntax highlighting, markdown with Shiki).
 * Pure utility functions (diff computation, language detection, etc.) live in
 * `diff-utils.ts` which is safe to import from client code.
 */
import MarkdownIt from 'markdown-it';
import Shiki from '@shikijs/markdown-it';
import taskLists from 'markdown-it-task-lists';
import footnote from 'markdown-it-footnote';
import {claudeLight} from './claude-light-theme';
import {extractLineNumbers} from './diff-utils';

let md: MarkdownIt | null = null;

/**
 * Simple bounded LRU cache. Content-addressable rendering caches use this:
 * the same input always produces the same output, so we can safely memoize
 * across requests without invalidation. We cap size to bound memory.
 */
class LruCache<V> {
	private readonly map = new Map<string, V>();
	constructor(private readonly maxEntries: number) {}

	get(key: string): V | undefined {
		const value = this.map.get(key);
		if (value === undefined) return undefined;
		// Refresh recency by re-inserting
		this.map.delete(key);
		this.map.set(key, value);
		return value;
	}

	set(key: string, value: V): void {
		if (this.map.has(key)) this.map.delete(key);
		this.map.set(key, value);
		if (this.map.size > this.maxEntries) {
			const oldestKey = this.map.keys().next().value;
			if (oldestKey !== undefined) this.map.delete(oldestKey);
		}
	}

	clear(): void {
		this.map.clear();
	}
}

const renderMarkdownCache = new LruCache<string>(2000);

/** Exposed for tests to reset cache state. */
export function clearRenderCaches(): void {
	renderMarkdownCache.clear();
}

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
		const {text: cleanCode, startLine, hasLineNumbers} = extractLineNumbers(code);

		if (originalHighlight) {
			try {
				const result = originalHighlight(cleanCode, lang, attrs);

				if (hasLineNumbers) {
					return enhanceWithLineNumbers(result, startLine);
				}

				return result;
			} catch {
				// Language not supported by Shiki -- fall through to plain text
			}
		}
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

export async function renderMarkdown(markdown: string): Promise<string> {
	if (!markdown.trim()) return '';
	const cached = renderMarkdownCache.get(markdown);
	if (cached !== undefined) return cached;
	const instance = await getMd();
	const html = instance.render(markdown);
	renderMarkdownCache.set(markdown, html);
	return html;
}
