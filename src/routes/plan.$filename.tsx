import {createFileRoute, Link} from '@tanstack/react-router';
import {createServerFn} from '@tanstack/react-start';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {readPlan} from '../lib/plans';
import {renderMarkdown} from '../lib/renderer';
import {extractTitleFromContent} from '../lib/markdown-utils';
import {MarkdownArticle} from '../components/markdown-article';
import {getPlanLinks} from '../lib/server-fns';

const PLANS_DIR = process.env['PLANS_DIR'] ?? join(homedir(), '.claude', 'plans');

const getPlan = createServerFn({method: 'GET'})
	.inputValidator((d: string) => d)
	.handler(async ({data: filename}) => {
		const content = await readPlan(PLANS_DIR, filename);
		if (!content) return null;
		const html = await renderMarkdown(content);
		const title = extractTitleFromContent(content, filename);
		const links = await getPlanLinks({data: filename});
		return {html, title, links};
	});

export const Route = createFileRoute('/plan/$filename')({
	component: PlanPage,
	loader: ({params}) => getPlan({data: params.filename}),
	head: ({loaderData}) => ({
		meta: [{title: loaderData?.title ?? 'Plan Not Found'}],
	}),
});

function PlanPage() {
	const loaderData = Route.useLoaderData();
	const state = Route.useMatch({select: (m) => (m as unknown as {state?: {html?: string; title?: string}}).state});
	const data = state?.html
		? {html: state.html, title: state.title ?? loaderData?.title ?? '', links: loaderData?.links ?? []}
		: loaderData;

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
			<div className="flex items-center gap-4">
				<Link
					to="/plans"
					className="text-sm text-primary hover:underline"
				>
					&larr; All Plans
				</Link>
				<Link
					to="/plan/$filename/edit"
					params={{filename: Route.useParams().filename}}
					className="text-sm text-primary hover:underline"
				>
					Edit
				</Link>
			</div>
			<div className="mt-4">
				<MarkdownArticle html={data.html} />
			</div>

			{data.links.length > 0 && (
				<section className="mt-8 border-t border-border pt-4">
					<h2 className="text-sm font-semibold">Sessions that used this plan</h2>
					<ul className="mt-2 space-y-1">
						{data.links.map((link) => (
							<li key={link.sessionId}>
								<Link
									to="/session/$id"
									params={{id: link.sessionId}}
									className="block rounded-md p-2 text-sm transition-colors hover:bg-muted/50"
								>
									<span className="text-muted-foreground">{link.projectName}</span>
									<span className="mx-1.5 text-muted-foreground">&middot;</span>
									<span className="font-mono text-xs">{link.sessionId.slice(0, 8)}</span>
								</Link>
							</li>
						))}
					</ul>
				</section>
			)}
		</div>
	);
}
