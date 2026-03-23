import {createFileRoute, Link, useNavigate} from '@tanstack/react-router';
import {createServerFn} from '@tanstack/react-start';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {readMemory, deleteMemory, decodeProjectDir} from '../lib/memory';
import {renderMarkdown} from '../lib/renderer';
import {extractTitleFromContent} from '../lib/markdown-utils';
import {MarkdownArticle} from '../components/markdown-article';
import {ArrowLeft, Pencil, Trash2} from 'lucide-react';
import {DetailTopBar, pillStyles} from '../components/detail-top-bar';
import {useCallback, useState} from 'react';

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

const removeMemory = createServerFn({method: 'POST'})
	.inputValidator((d: {project: string; filename: string}) => d)
	.handler(async ({data: {project, filename}}) => {
		return deleteMemory(PROJECTS_DIR, project, filename);
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
	const {project, filename} = Route.useParams();
	const navigate = useNavigate();
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const [deleting, setDeleting] = useState(false);
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

	const handleDelete = useCallback(async () => {
		setDeleting(true);
		const ok = await removeMemory({data: {project, filename}});
		if (ok) {
			navigate({to: '/memories'});
		} else {
			setDeleting(false);
			setConfirmingDelete(false);
		}
	}, [project, filename, navigate]);

	if (!data) {
		return (
			<div>
				<DetailTopBar>
					<Link
						to="/memories"
						className={pillStyles.primary}
					>
						<ArrowLeft className="h-3.5 w-3.5" />
						All Memories
					</Link>
				</DetailTopBar>
				<h1 className="mt-4 text-lg font-semibold">Memory Not Found</h1>
				<p className="mt-2 text-text-500">This memory file could not be found.</p>
			</div>
		);
	}

	return (
		<div>
			<DetailTopBar>
				<Link
					to="/memories"
					className={pillStyles.primary}
				>
					<ArrowLeft className="h-3.5 w-3.5" />
					All Memories
				</Link>
				<span className="text-xs text-text-500">{data.projectName}</span>
				<Link
					to="/memory/$project/$filename/edit"
					params={{project, filename}}
					className={pillStyles.outline}
				>
					<Pencil className="h-3 w-3" />
					Edit
				</Link>
				{confirmingDelete ? (
					<span className="inline-flex items-center gap-1.5 text-xs">
						<span className="text-danger-000">Delete this memory?</span>
						<button
							type="button"
							onClick={handleDelete}
							disabled={deleting}
							className="rounded bg-danger-000 px-2 py-1 text-xs font-medium text-white hover:bg-danger-000/80 disabled:opacity-50"
						>
							{deleting ? 'Deleting...' : 'Yes, delete'}
						</button>
						<button
							type="button"
							onClick={() => setConfirmingDelete(false)}
							className={pillStyles.outline}
						>
							Cancel
						</button>
					</span>
				) : (
					<button
						type="button"
						onClick={() => setConfirmingDelete(true)}
						className={`${pillStyles.outline} text-danger-000 hover:bg-danger-000/10`}
					>
						<Trash2 className="h-3 w-3" />
						Delete
					</button>
				)}
			</DetailTopBar>
			<div className="mt-4">
				<MarkdownArticle html={data.html} />
			</div>
		</div>
	);
}
