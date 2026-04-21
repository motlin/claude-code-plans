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
