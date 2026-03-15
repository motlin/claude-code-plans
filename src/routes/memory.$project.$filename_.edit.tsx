import {createFileRoute, Link, useNavigate} from '@tanstack/react-router';
import {createServerFn} from '@tanstack/react-start';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {readMemory, writeMemory, decodeProjectDir} from '../lib/memory';
import {renderMarkdown} from '../lib/renderer';
import {extractTitleFromContent} from '../lib/markdown-utils';
import {lazy, Suspense, useCallback, useEffect, useRef, useState} from 'react';

const MarkdownEditor = lazy(() => import('../components/markdown-editor').then((m) => ({default: m.MarkdownEditor})));

function ClientOnly({children, fallback}: {children: React.ReactNode; fallback: React.ReactNode}) {
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);
	return mounted ? children : fallback;
}

const PROJECTS_DIR = join(homedir(), '.claude', 'projects');

const getMemoryRaw = createServerFn({method: 'GET'})
	.inputValidator((d: {project: string; filename: string}) => d)
	.handler(async ({data: {project, filename}}) => {
		const content = await readMemory(PROJECTS_DIR, project, filename);
		if (!content) return null;
		const title = extractTitleFromContent(content, filename);
		const projectName = decodeProjectDir(project);
		return {markdown: content, title, projectName};
	});

const saveMemory = createServerFn({method: 'POST'})
	.inputValidator((d: {project: string; filename: string; content: string}) => d)
	.handler(async ({data: {project, filename, content}}) => {
		const ok = await writeMemory(PROJECTS_DIR, project, filename, content);
		if (!ok) return null;
		const html = await renderMarkdown(content);
		const title = extractTitleFromContent(content, filename);
		const projectName = decodeProjectDir(project);
		return {html, title, projectName};
	});

export const Route = createFileRoute('/memory/$project/$filename_/edit')({
	component: MemoryEditPage,
	loader: ({params}) => getMemoryRaw({data: {project: params.project, filename: params.filename}}),
	head: ({loaderData}) => ({
		meta: [{title: loaderData ? `Edit: ${loaderData.title}` : 'Memory Not Found'}],
	}),
});

function MemoryEditPage() {
	const data = Route.useLoaderData();
	const {project, filename} = Route.useParams();

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
		setFeedback(result ? 'Saved' : 'Failed to save');
	}, [doSave]);

	const handlePreview = useCallback(async () => {
		setSaving(true);
		const result = await doSave();
		setSaving(false);
		navigate({
			to: '/memory/$project/$filename',
			params: {project, filename},
			state: (result
				? {html: result.html, title: result.title, projectName: result.projectName}
				: undefined) as unknown as true,
		});
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
