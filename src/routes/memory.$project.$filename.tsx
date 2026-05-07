import {createFileRoute, Link, useNavigate} from '@tanstack/react-router';
import {createServerFn} from '@tanstack/react-start';
import {useSuspenseQuery} from '@tanstack/react-query';
import {MarkdownView} from '../components/markdown-view';
import {memoryDetailQueryOptions} from '../lib/api/memories';
import {ArrowLeft, Pencil, Trash2} from 'lucide-react';
import {DetailTopBar, pillStyles} from '../components/detail-top-bar';
import {DebugLink} from '../components/debug-link';
import {useCallback, useState} from 'react';

const removeMemory = createServerFn({method: 'POST'})
	.inputValidator((d: {project: string; filename: string}) => d)
	.handler(async ({data: {project, filename}}) => {
		const {homedir} = await import('node:os');
		const {join} = await import('node:path');
		const {deleteMemory} = await import('../lib/memory');
		const projectsDir = join(homedir(), '.claude', 'projects');
		return deleteMemory(projectsDir, project, filename);
	});

export const Route = createFileRoute('/memory/$project/$filename')({
	component: MemoryPage,
	loader: ({context: {queryClient}, params}) =>
		queryClient.ensureQueryData(memoryDetailQueryOptions(params.project, params.filename)),
	head: ({params}) => ({
		meta: [{title: params.filename}],
	}),
});

function MemoryPage() {
	const {project, filename} = Route.useParams();
	const {data} = useSuspenseQuery(memoryDetailQueryOptions(project, filename));
	const navigate = useNavigate();
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const [deleting, setDeleting] = useState(false);

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
				<DebugLink
					kind="memory"
					relativePath={`${project}/memory/${filename}`}
				/>
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
				<MarkdownView markdown={data.markdown} />
			</div>
		</div>
	);
}
