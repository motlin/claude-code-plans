import {createFileRoute, Link} from '@tanstack/react-router';
import {createServerFn} from '@tanstack/react-start';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {readSession, summarizeToolCalls} from '../lib/sessions';
import {renderMarkdown, renderToolResultHtml} from '../lib/renderer';
import {SessionChat} from '../components/session-chat';

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

		return {title: detail.title, projectName: detail.projectName, messages};
	});

export const Route = createFileRoute('/session/$id')({
	component: SessionPage,
	loader: ({params}) => getSession({data: {id: params.id}}),
	head: ({loaderData}) => ({
		meta: [{title: loaderData?.title ?? 'Session Not Found'}],
	}),
});

function SessionPage() {
	const data = Route.useLoaderData();

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
			<SessionChat messages={data.messages} />
		</div>
	);
}
