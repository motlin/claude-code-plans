import {createFileRoute, Link, useNavigate} from '@tanstack/react-router';
import {createServerFn} from '@tanstack/react-start';
import {useSuspenseQuery} from '@tanstack/react-query';
import {z} from 'zod';
import {memoryDetailQueryOptions} from '../lib/api/memories';
import {lazy, Suspense, useCallback, useEffect, useRef, useState} from 'react';

const MarkdownEditor = lazy(() => import('../components/markdown-editor').then((m) => ({default: m.MarkdownEditor})));

function ClientOnly({children, fallback}: {children: React.ReactNode; fallback: React.ReactNode}) {
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);
	return mounted ? children : fallback;
}

const saveMemory = createServerFn({method: 'POST'})
	.inputValidator(z.object({project: z.string(), filename: z.string(), content: z.string()}))
	.handler(async ({data: {project, filename, content}}) => {
		const {homedir} = await import('node:os');
		const {join} = await import('node:path');
		const {writeMemory} = await import('../lib/memory');
		const projectsDir = join(homedir(), '.claude', 'projects');
		const ok = await writeMemory(projectsDir, project, filename, content);
		return {ok};
	});

export const Route = createFileRoute('/memory/$project/$filename_/edit')({
	component: MemoryEditPage,
	loader: ({context: {queryClient}, params}) =>
		queryClient.ensureQueryData(memoryDetailQueryOptions(params.project, params.filename)),
	head: ({params}) => ({
		meta: [{title: `Edit: ${params.filename}`}],
	}),
});

function MemoryEditPage() {
	const {project, filename} = Route.useParams();
	const {data} = useSuspenseQuery(memoryDetailQueryOptions(project, filename));

	const initialMarkdown = data?.markdown ?? '';
	const draftRef = useRef(initialMarkdown);

	useEffect(() => {
		draftRef.current = initialMarkdown;
	}, [initialMarkdown]);

	const [saving, setSaving] = useState(false);
	const [feedback, setFeedback] = useState<string | null>(null);

	const handleChange = useCallback((value: string) => {
		draftRef.current = value;
	}, []);

	const navigate = useNavigate();

	const doSave = useCallback(async () => {
		return saveMemory({data: {project, filename, content: draftRef.current}});
	}, [project, filename]);

	const handleSave = useCallback(async () => {
		setSaving(true);
		setFeedback(null);
		const result = await doSave();
		setSaving(false);
		setFeedback(result.ok ? 'Saved' : 'Failed to save');
	}, [doSave]);

	const handlePreview = useCallback(async () => {
		setSaving(true);
		const result = await doSave();
		setSaving(false);
		if (result.ok) {
			navigate({
				to: '/memory/$project/$filename',
				params: {project, filename},
			});
		}
	}, [doSave, navigate, project, filename]);

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
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center gap-4">
				<Link
					to="/memories"
					className="text-sm text-accent-100 hover:underline"
				>
					&larr; All Memories
				</Link>
				<button
					type="button"
					onClick={handlePreview}
					className="text-sm text-accent-100 hover:underline"
				>
					Preview
				</button>
				<span className="text-xs text-text-500">{data.projectName}</span>
				<button
					type="button"
					onClick={handleSave}
					disabled={saving}
					className="rounded bg-accent-100 px-3 py-1 text-sm text-bg-000 hover:bg-accent-100/90 disabled:opacity-50"
				>
					{saving ? 'Saving...' : 'Save'}
				</button>
				{feedback && (
					<span className={`text-sm ${feedback === 'Saved' ? 'text-success-000' : 'text-danger-000'}`}>
						{feedback}
					</span>
				)}
			</div>
			<ClientOnly fallback={<div className="text-text-500 text-sm">Loading editor...</div>}>
				<Suspense fallback={<div className="text-text-500 text-sm">Loading editor...</div>}>
					<MarkdownEditor
						key={initialMarkdown}
						markdown={initialMarkdown}
						onChange={handleChange}
					/>
				</Suspense>
			</ClientOnly>
		</div>
	);
}
