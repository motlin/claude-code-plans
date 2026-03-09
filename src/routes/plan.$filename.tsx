import {createFileRoute, Link} from '@tanstack/react-router';
import {createServerFn} from '@tanstack/react-start';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {readPlan} from '../lib/plans';
import {renderMarkdown} from '../lib/renderer';
import {extractTitleFromContent} from '../lib/markdown-utils';
import {MarkdownArticle} from '../components/markdown-article';

const PLANS_DIR = process.env['PLANS_DIR'] ?? join(homedir(), '.claude', 'plans');

const getPlan = createServerFn({method: 'GET'})
	.inputValidator((d: string) => d)
	.handler(async ({data: filename}) => {
		const content = await readPlan(PLANS_DIR, filename);
		if (!content) return null;
		const html = await renderMarkdown(content);
		const title = extractTitleFromContent(content, filename);
		return {html, title};
	});

export const Route = createFileRoute('/plan/$filename')({
	component: PlanPage,
	loader: ({params}) => getPlan({data: params.filename}),
	head: ({loaderData}) => ({
		meta: [{title: loaderData?.title ?? 'Plan Not Found'}],
	}),
});

function PlanPage() {
	const data = Route.useLoaderData();

	if (!data) {
		return (
			<div>
				<Link
					to="/plans"
					className="text-sm text-primary hover:underline"
				>
					&larr; All Plans
				</Link>
				<h1 className="mt-4 text-lg font-semibold">Plan Not Found</h1>
				<p className="mt-2 text-muted-foreground">This plan could not be found.</p>
			</div>
		);
	}

	return (
		<div>
			<Link
				to="/plans"
				className="text-sm text-primary hover:underline"
			>
				&larr; All Plans
			</Link>
			<div className="mt-4">
				<MarkdownArticle html={data.html} />
			</div>
		</div>
	);
}
