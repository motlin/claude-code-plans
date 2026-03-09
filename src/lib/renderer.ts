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
