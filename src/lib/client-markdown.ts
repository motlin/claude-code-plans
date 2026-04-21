import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import footnote from 'markdown-it-footnote';

let instance: MarkdownIt | null = null;

function getMarkdownIt(): MarkdownIt {
	if (instance) return instance;
	instance = MarkdownIt({html: true, linkify: true});
	instance.use(taskLists);
	instance.use(footnote);
	return instance;
}

export function renderMarkdownToHtml(markdown: string): string {
	if (!markdown.trim()) return '';
	return getMarkdownIt().render(markdown);
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
