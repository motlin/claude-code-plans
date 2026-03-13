import {createFileRoute, Link} from '@tanstack/react-router';
import {createServerFn} from '@tanstack/react-start';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {useEffect, useState} from 'react';
import {readSession, summarizeToolCalls} from '../lib/sessions';
import {renderMarkdown, computeDiffData} from '../lib/renderer';
import {SessionChat} from '../components/session-chat';
import {
	getSubagents,
	getSessionSummary,
	requestSummary,
	isStarred,
	toggleSessionStar,
	getActiveSessions,
} from '../lib/server-fns';
import {getDb} from '../lib/db';
import {sessions} from '../lib/db/schema';
import {eq} from 'drizzle-orm';
import type {ClientToolCall, ToolInput} from '../components/tool-renderers';

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
				const toolCalls: ClientToolCall[] = msg.toolCalls.map((tc) => {
					const call: ClientToolCall = {
						id: tc.id,
						name: tc.name,
						input: tc.input as ToolInput,
						param: getToolParam(tc),
					};
					if (tc.result !== undefined) call.result = tc.result;
					if (tc.isError !== undefined) call.isError = tc.isError;
					if (tc.duration !== undefined) call.duration = tc.duration;

					if ((tc.name === 'Edit' || tc.name === 'MultiEdit') && tc.input['old_string'] !== undefined) {
						const oldStr = (tc.input['old_string'] as string) ?? '';
						const newStr = (tc.input['new_string'] as string) ?? '';
						call.diffData = computeDiffData(oldStr, newStr);
					}

					return call;
				});

				const toolSummary = summarizeToolCalls(msg.toolCalls);
				const htmlBlocks = await Promise.all(msg.textBlocks.map((text) => renderMarkdown(text)));

				const thinkingBlocks: string[] = [];
				const imageBlocks: Array<{mediaType: string; data: string}> = [];
				let command: {name: string; args?: string} | undefined;

				for (const block of msg.content) {
					if (block.type === 'thinking') {
						thinkingBlocks.push(block.thinking);
					} else if (block.type === 'image') {
						imageBlocks.push({mediaType: block.mediaType, data: block.data});
					} else if (block.type === 'command') {
						command = {name: block.name};
						if (block.args) (command as {name: string; args: string}).args = block.args;
					}
				}

				const result: {
					role: 'user' | 'assistant';
					htmlBlocks: string[];
					thinkingBlocks: string[];
					imageBlocks: Array<{mediaType: string; data: string}>;
					toolCalls: ClientToolCall[];
					toolSummary: string;
					command?: {name: string; args?: string};
				} = {
					role: msg.role,
					htmlBlocks,
					thinkingBlocks,
					imageBlocks,
					toolCalls,
					toolSummary,
				};
				if (command) result.command = command;
				return result;
			}),
		);

		const [subagents, summaryResult, starResult, activeSessions] = await Promise.all([
			getSubagents({data: id}),
			getSessionSummary({data: id}),
			isStarred({data: id}),
			getActiveSessions(),
		]);

		const {index} = getDb();
		const sessionRow = index.select().from(sessions).where(eq(sessions.id, id)).get();
		const hasSummary = !!(sessionRow?.summary || sessionRow?.customTitle);

		return {
			title: detail.title,
			projectName: detail.projectName,
			projectId: detail.projectId,
			messages,
			subagents,
			aiSummary: summaryResult.summary,
			starred: starResult.starred,
			isActive: activeSessions.some((a) => a.sessionId === id),
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
	const [starred, setStarred] = useState(data?.starred ?? false);
	const [isActive, setIsActive] = useState(data?.isActive ?? false);
	const [generating, setGenerating] = useState(false);

	useEffect(() => {
		if (!isActive) return;
		const interval = setInterval(async () => {
			const active = await getActiveSessions();
			setIsActive(active.some((a) => a.sessionId === params.id));
		}, 5000);
		return () => clearInterval(interval);
	}, [isActive, params.id]);

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
			<div className="mt-2 flex items-center gap-2">
				<h1 className="text-lg font-semibold">{data.title}</h1>
				{isActive && (
					<span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-300">
						<span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
						Active
					</span>
				)}
				<button
					type="button"
					onClick={async () => {
						const result = await toggleSessionStar({data: params.id});
						setStarred(result.starred);
					}}
					className="shrink-0 cursor-pointer text-muted-foreground transition-colors hover:text-yellow-500"
					title={starred ? 'Unstar session' : 'Star session'}
				>
					<svg
						viewBox="0 0 24 24"
						className="h-5 w-5"
						fill={starred ? 'currentColor' : 'none'}
						stroke="currentColor"
						strokeWidth="2"
						style={{color: starred ? 'rgb(234, 179, 8)' : undefined}}
					>
						<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
					</svg>
				</button>
			</div>

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
							<Link
								key={agent.id}
								to="/session/$id"
								params={{id: agent.id}}
								className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs transition-colors hover:bg-muted/50"
							>
								{agent.agentType && (
									<span
										className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${AGENT_TYPE_COLORS[agent.agentType] ?? 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'}`}
									>
										{agent.agentType}
									</span>
								)}
								<span className="text-muted-foreground">{agent.slug ?? agent.id}</span>
							</Link>
						))}
					</div>
				</div>
			)}

			<SessionChat messages={data.messages} />
		</div>
	);
}
