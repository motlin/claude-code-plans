import type {HighlighterCore} from '@shikijs/core';
import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import footnote from 'markdown-it-footnote';

let plainInstance: MarkdownIt | null = null;
let highlightedInstance: MarkdownIt | null = null;
let boundHighlighter: HighlighterCore | null = null;

function getPlainMarkdownIt(): MarkdownIt {
	if (plainInstance) return plainInstance;
	plainInstance = MarkdownIt({html: true, linkify: true});
	plainInstance.use(taskLists);
	plainInstance.use(footnote);
	return plainInstance;
}

function getHighlightedMarkdownIt(highlighter: HighlighterCore): MarkdownIt {
	// Re-use the cached instance if the highlighter hasn't changed.
	if (highlightedInstance && boundHighlighter === highlighter) return highlightedInstance;

	const loadedLanguages = highlighter.getLoadedLanguages();
	highlightedInstance = MarkdownIt({
		html: true,
		linkify: true,
		highlight(code: string, lang: string): string {
			const language = lang || 'text';
			if (language === 'text' || !loadedLanguages.includes(language)) return '';
			try {
				let trimmed = code;
				if (trimmed.endsWith('\n')) trimmed = trimmed.slice(0, -1);
				return highlighter.codeToHtml(trimmed, {
					lang: language,
					themes: {
						light: 'claude-light',
						dark: 'github-dark',
					},
					defaultColor: 'light',
					cssVariablePrefix: '--shiki-',
				});
			} catch {
				return '';
			}
		},
	});
	highlightedInstance.use(taskLists);
	highlightedInstance.use(footnote);
	boundHighlighter = highlighter;
	return highlightedInstance;
}

/** Render markdown to HTML without syntax highlighting. */
export function renderMarkdownToHtml(markdown: string): string {
	if (!markdown.trim()) return '';
	return getPlainMarkdownIt().render(markdown);
}

/**
 * Render markdown to HTML with Shiki syntax highlighting for code blocks.
 * When `highlighter` is null (not yet loaded), falls back to unstyled code.
 */
export function renderMarkdownWithHighlighting(markdown: string, highlighter: HighlighterCore | null): string {
	if (!markdown.trim()) return '';
	if (!highlighter) return renderMarkdownToHtml(markdown);
	return getHighlightedMarkdownIt(highlighter).render(markdown);
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
