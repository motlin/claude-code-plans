import {createFileRoute, Link, useNavigate} from '@tanstack/react-router';
import {createServerFn} from '@tanstack/react-start';
import {z} from 'zod';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {readPlan, writePlan} from '../lib/plans';
import {renderMarkdown} from '../lib/renderer';
import {extractTitleFromContent} from '../lib/markdown-utils';
import {lazy, Suspense, useCallback, useEffect, useRef, useState} from 'react';

const MarkdownEditor = lazy(() => import('../components/markdown-editor').then((m) => ({default: m.MarkdownEditor})));

function ClientOnly({children, fallback}: {children: React.ReactNode; fallback: React.ReactNode}) {
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);
	return mounted ? children : fallback;
}

const PLANS_DIR = join(homedir(), '.claude', 'plans');

const getPlanRaw = createServerFn({method: 'GET'})
	.inputValidator(z.string())
	.handler(async ({data: filename}) => {
		const content = await readPlan(PLANS_DIR, filename);
		if (!content) return null;
		const title = extractTitleFromContent(content, filename);
		return {markdown: content, title};
	});

const savePlan = createServerFn({method: 'POST'})
	.inputValidator(z.object({filename: z.string(), content: z.string()}))
	.handler(async ({data: {filename, content}}) => {
		const ok = await writePlan(PLANS_DIR, filename, content);
		if (!ok) return null;
		const html = await renderMarkdown(content);
		const title = extractTitleFromContent(content, filename);
		return {html, title};
	});

export const Route = createFileRoute('/plan/$filename_/edit')({
	component: PlanEditPage,
	loader: ({params}) => getPlanRaw({data: params.filename}),
	head: ({loaderData}) => ({
		meta: [{title: loaderData ? `Edit: ${loaderData.title}` : 'Plan Not Found'}],
	}),
});

function PlanEditPage() {
	const data = Route.useLoaderData();
	const {filename} = Route.useParams();

	const initialMarkdown = data?.markdown ?? '';
	const draftRef = useRef(initialMarkdown);

	// Re-sync ref when loader data changes (e.g. after save + navigate back)
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
		return savePlan({data: {filename, content: draftRef.current}});
	}, [filename]);

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
			to: '/plan/$filename',
			params: {filename},
			state: (result ? {html: result.html, title: result.title} : undefined) as unknown as true,
		});
	}, [doSave, navigate, filename]);

	if (!data) {
		return (
			<div>
				<Link
					to="/plans"
					className="text-sm text-accent-100 hover:underline"
				>
					&larr; All Plans
				</Link>
				<h1 className="mt-4 text-lg font-semibold">Plan Not Found</h1>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center gap-4">
				<Link
					to="/plans"
					className="text-sm text-accent-100 hover:underline"
				>
					&larr; All Plans
				</Link>
				<button
					type="button"
					onClick={handlePreview}
					className="text-sm text-accent-100 hover:underline"
				>
					Preview
				</button>
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
