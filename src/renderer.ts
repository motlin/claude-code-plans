import MarkdownIt from 'markdown-it';
import Shiki from '@shikijs/markdown-it';

let md: MarkdownIt | null = null;

async function getMd(): Promise<MarkdownIt> {
	if (md) return md;
	md = MarkdownIt({html: true});
	md.use(
		await Shiki({
			themes: {
				light: 'github-light',
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
