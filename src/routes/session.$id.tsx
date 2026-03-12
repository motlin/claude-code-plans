import {createFileRoute, Link} from '@tanstack/react-router';
import {createServerFn} from '@tanstack/react-start';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {useState} from 'react';
import {readSession, summarizeToolCalls} from '../lib/sessions';
import {renderMarkdown, renderToolResultHtml} from '../lib/renderer';
import {SessionChat} from '../components/session-chat';
import {getSubagents, getSessionSummary, requestSummary} from '../lib/server-fns';
import {getDb} from '../lib/db';
import {sessions} from '../lib/db/schema';
import {eq} from 'drizzle-orm';

const PROJECTS_DIR = join(homedir(), '.claude', 'projects');

function getToolParam(tc: {input: Record<string, unknown>}): string {
	const input = tc.input;
	if (typeof input['file_path'] === 'string') return input['file_path'];
	if (typeof input['command'] === 'string') {
		const cmd = input['command'];
		return cmd.length > 60 ? cmd.slice(0, 60) + '...' : cmd;
	}
	if (typeof input['pattern'] === 'string') return input['pattern'];
	if (typeof input['query'] === 'string') return input['query'];
	if (typeof input['prompt'] === 'string') {
		const p = input['prompt'];
		return p.length > 60 ? p.slice(0, 60) + '...' : p;
	}
	return '';
}

const getSession = createServerFn({method: 'GET'})
	.inputValidator((d: {id: string}) => d)
	.handler(async ({data: {id}}) => {
		const detail = await readSession(PROJECTS_DIR, id);
		if (!detail) return null;

		const messages = await Promise.all(
			detail.messages.map(async (msg) => {
				const toolCalls = await Promise.all(
					msg.toolCalls.map(async (tc) => {
						const resultHtml = tc.result
							? await renderToolResultHtml(tc.name, tc.input, tc.result, tc.isError ?? false)
							: undefined;
						const call: {name: string; param: string; resultHtml?: string} = {
							name: tc.name,
							param: getToolParam(tc),
						};
						if (resultHtml !== undefined) {
							call.resultHtml = resultHtml;
						}
						return call;
					}),
				);
				const toolSummary = summarizeToolCalls(msg.toolCalls);
				const htmlBlocks = await Promise.all(msg.textBlocks.map((text) => renderMarkdown(text)));
				if (msg.role === 'assistant') {
					return {role: 'assistant' as const, htmlBlocks, toolCalls, toolSummary};
				}
				return {role: 'user' as const, htmlBlocks, toolCalls, toolSummary};
			}),
		);

		const [subagents, summaryResult] = await Promise.all([getSubagents({data: id}), getSessionSummary({data: id})]);

		// Check if this session already has a summary or custom title from the index
		const {index} = getDb();
		const sessionRow = index.select().from(sessions).where(eq(sessions.id, id)).get();
		const hasSummary = !!(sessionRow?.summary || sessionRow?.customTitle);

		return {
			title: detail.title,
			projectName: detail.projectName,
			messages,
			subagents,
			aiSummary: summaryResult.summary,
			hasSummary,
		};
	});

export const Route = createFileRoute('/session/$id')({
	component: SessionPage,
	loader: ({params}) => getSession({data: {id: params.id}}),
	head: ({loaderData}) => ({
		meta: [{title: loaderData?.title ?? 'Session Not Found'}],
	}),
});

const AGENT_TYPE_COLORS: Record<string, string> = {
	Explore: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
	Plan: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
};

function SessionPage() {
	const data = Route.useLoaderData();
	const params = Route.useParams();
	const [aiSummary, setAiSummary] = useState<string | null>(data?.aiSummary ?? null);
	const [generating, setGenerating] = useState(false);

	if (!data) {
		return (
			<div>
				<Link
					to="/sessions"
					className="text-sm text-primary hover:underline"
				>
					&larr; All Sessions
				</Link>
				<h1 className="mt-4 text-lg font-semibold">Session Not Found</h1>
				<p className="mt-2 text-muted-foreground">This session could not be found.</p>
			</div>
		);
	}

	async function handleGenerateSummary() {
		setGenerating(true);
		try {
			const result = await requestSummary({data: params.id});
			if (result.summary) {
				setAiSummary(result.summary);
			}
		} finally {
			setGenerating(false);
		}
	}

	return (
		<div>
			<div className="flex items-center gap-2">
				<Link
					to="/sessions"
					className="text-sm text-primary hover:underline"
				>
					&larr; All Sessions
				</Link>
				<span className="text-xs text-muted-foreground">{data.projectName}</span>
			</div>
			<h1 className="mt-2 text-lg font-semibold">{data.title}</h1>

			{aiSummary ? (
				<p className="mt-1 text-sm text-muted-foreground italic">{aiSummary}</p>
			) : (
				!data.hasSummary && (
					<button
						type="button"
						onClick={handleGenerateSummary}
						disabled={generating}
						className="mt-1 text-xs text-primary hover:underline disabled:opacity-50 disabled:no-underline"
					>
						{generating ? 'Generating summary...' : 'Generate AI summary'}
					</button>
				)
			)}

			{data.subagents.length > 0 && (
				<div className="mt-3">
					<h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
						Subagents ({data.subagents.length})
					</h2>
					<div className="mt-1 flex flex-wrap gap-2">
						{data.subagents.map((agent) => (
							<span
								key={agent.id}
								className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs"
							>
								{agent.agentType && (
									<span
										className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${AGENT_TYPE_COLORS[agent.agentType] ?? 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'}`}
									>
										{agent.agentType}
									</span>
								)}
								<span className="text-muted-foreground">{agent.slug ?? agent.id}</span>
							</span>
						))}
					</div>
				</div>
			)}

			<SessionChat messages={data.messages} />
		</div>
	);
}
