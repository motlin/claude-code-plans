import {createFileRoute, Link} from '@tanstack/react-router';
import {createServerFn} from '@tanstack/react-start';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {readMemory, decodeProjectDir} from '../lib/memory';
import {renderMarkdown} from '../lib/renderer';
import {extractTitleFromContent} from '../lib/markdown-utils';
import {MarkdownArticle} from '../components/markdown-article';

const PROJECTS_DIR = join(homedir(), '.claude', 'projects');

const getMemory = createServerFn({method: 'GET'})
	.inputValidator((d: {project: string; filename: string}) => d)
	.handler(async ({data: {project, filename}}) => {
		const content = await readMemory(PROJECTS_DIR, project, filename);
		if (!content) return null;
		const html = await renderMarkdown(content);
		const title = extractTitleFromContent(content, filename);
		const projectName = decodeProjectDir(project);
		return {html, title, projectName};
	});

export const Route = createFileRoute('/memory/$project/$filename')({
	component: MemoryPage,
	loader: ({params}) => getMemory({data: {project: params.project, filename: params.filename}}),
	head: ({loaderData}) => ({
		meta: [{title: loaderData?.title ?? 'Memory Not Found'}],
	}),
});

function MemoryPage() {
	const loaderData = Route.useLoaderData();
	const state = Route.useMatch({
		select: (m) => (m as unknown as {state?: {html?: string; title?: string; projectName?: string}}).state,
	});
	const data = state?.html
		? {
				html: state.html,
				title: state.title ?? loaderData?.title ?? '',
				projectName: state.projectName ?? loaderData?.projectName ?? '',
			}
		: loaderData;

	if (!data) {
		return (
			<div>
				<Link
					to="/memories"
					className="text-sm text-accent-100 hover:underline"
				>
					&larr; All Memories
				</Link>
				<h1 className="mt-4 text-lg font-semibold">Memory Not Found</h1>
				<p className="mt-2 text-text-500">This memory file could not be found.</p>
			</div>
		);
	}

	return (
		<div>
			<div className="flex items-center gap-2">
				<Link
					to="/memories"
					className="text-sm text-accent-100 hover:underline"
				>
					&larr; All Memories
				</Link>
				<span className="text-xs text-text-500">{data.projectName}</span>
				<Link
					to="/memory/$project/$filename/edit"
					params={Route.useParams()}
					className="text-sm text-accent-100 hover:underline"
				>
					Edit
				</Link>
			</div>
			<div className="mt-4">
				<MarkdownArticle html={data.html} />
			</div>
		</div>
	);
}
