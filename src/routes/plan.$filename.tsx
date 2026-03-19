import {createFileRoute, Link} from '@tanstack/react-router';
import {createServerFn} from '@tanstack/react-start';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {readPlan} from '../lib/plans';
import {renderMarkdown} from '../lib/renderer';
import {extractTitleFromContent} from '../lib/markdown-utils';
import {MarkdownArticle} from '../components/markdown-article';
import {getPlanLinks} from '../lib/server-fns';
import {ArrowLeft, Pencil, FolderOpen, MessageSquare} from 'lucide-react';
import {DetailTopBar, pillStyles} from '../components/detail-top-bar';

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
				<DetailTopBar>
					<Link
						to="/plans"
						className={pillStyles.primary}
					>
						<ArrowLeft className="h-3.5 w-3.5" />
						All Plans
					</Link>
				</DetailTopBar>
				<h1 className="mt-4 text-lg font-semibold">Plan Not Found</h1>
				<p className="mt-2 text-text-500">This plan could not be found.</p>
			</div>
		);
	}

	return (
		<div>
			<DetailTopBar>
				<Link
					to="/plans"
					className={pillStyles.primary}
				>
					<ArrowLeft className="h-3.5 w-3.5" />
					All Plans
				</Link>
				<Link
					to="/plan/$filename/edit"
					params={{filename: Route.useParams().filename}}
					className={pillStyles.outline}
				>
					<Pencil className="h-3 w-3" />
					Edit
				</Link>
			</DetailTopBar>
			<div className="mt-4">
				<MarkdownArticle html={data.html} />
			</div>

			{data.links.length > 0 && (
				<section className="mt-8 border-t border-border-300/15 pt-6">
					<h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-400">
						Related Sessions
					</h2>
					{(() => {
						const byProject = new Map<string, {projectName: string; sessions: typeof data.links}>();
						for (const link of data.links) {
							const key = link.project;
							if (!byProject.has(key)) {
								byProject.set(key, {projectName: link.projectName, sessions: []});
							}
							byProject.get(key)!.sessions.push(link);
						}
						return [...byProject.entries()].map(([projectId, group]) => (
							<div
								key={projectId}
								className="mt-3"
							>
								<Link
									to="/project/$id"
									params={{id: projectId}}
									className="mb-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-text-200 no-underline transition-colors hover:bg-bg-200/50"
								>
									<FolderOpen className="h-3.5 w-3.5 shrink-0 text-text-400" />
									{group.projectName}
									<span className="ml-auto text-[10px] text-text-500">
										{group.sessions.length} {group.sessions.length === 1 ? 'session' : 'sessions'}
									</span>
								</Link>
								<div className="space-y-px pl-4">
									{group.sessions.map((link) => (
										<Link
											key={link.sessionId}
											to="/session/$id"
											params={{id: link.sessionId}}
											className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-text-300 no-underline transition-colors hover:bg-bg-200/50 hover:text-text-100"
										>
											<MessageSquare className="h-3 w-3 shrink-0 text-text-500" />
											<span className="truncate">{link.sessionTitle || 'Untitled session'}</span>
										</Link>
									))}
								</div>
							</div>
						));
					})()}
				</section>
			)}
		</div>
	);
}
