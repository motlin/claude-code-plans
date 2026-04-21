import {Link} from '@tanstack/react-router';
import {Bot} from 'lucide-react';
import {MarkdownArticle} from '../markdown-article';
import type {ToolRendererProps} from './types';
import {DurationBadge, ErrorBorder, ExpandableBlock, formatDuration} from './shared';
import {looksLikeMarkdown} from '../../lib/diff-utils';

const AGENT_TYPE_COLORS: Record<string, string> = {
	Explore: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
	Plan: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
	Code: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
	Research: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300',
	'general-purpose': 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
	'markdown-tasks': 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
	build: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
};

function statusBadge(status: 'running' | 'done' | 'error') {
	switch (status) {
		case 'running':
			return (
				<span className="inline-flex items-center gap-1 rounded bg-accent-000/12 text-accent-100 px-1.5 py-0.5 text-[10px] font-medium">
					<span className="h-1.5 w-1.5 rounded-full bg-accent-100 animate-pulse" />
					running
				</span>
			);
		case 'error':
			return (
				<span className="rounded bg-danger-000/15 text-danger-000 px-1.5 py-0.5 text-[10px] font-medium">
					error
				</span>
			);
		case 'done':
		default:
			return (
				<span className="rounded bg-success-900 text-success-000 px-1.5 py-0.5 text-[10px] font-medium">
					done
				</span>
			);
	}
}

function durationFromTimes(startedAt: string | null, finishedAt: string | null): number | null {
	if (!startedAt || !finishedAt) return null;
	const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
	return Number.isFinite(ms) && ms > 0 ? ms : null;
}

export function AgentRenderer({toolCall}: ToolRendererProps) {
	const prompt = (toolCall.input['prompt'] as string) ?? '';
	const agentType = (toolCall.input['subagent_type'] as string) ?? '';
	const description = (toolCall.input['description'] as string) ?? '';
	const {result, isError, subagentInfo} = toolCall;

	const agentIdMatch = result?.match(/agentId:\s*(\S+)/);
	const fallbackAgentId = agentIdMatch?.[1];
	const displayResult = fallbackAgentId ? result!.replace(/agentId:\s*\S+\n?/, '').trim() : result;
	const promptLineCount = prompt ? prompt.split('\n').length : 0;
	const outputLineCount = displayResult ? displayResult.split('\n').length : 0;

	const colorClass = AGENT_TYPE_COLORS[agentType] ?? 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300';

	const linkAgentId = subagentInfo?.agentId ?? (fallbackAgentId ? `agent-${fallbackAgentId}` : null);
	const timingDuration = subagentInfo
		? (toolCall.duration ?? durationFromTimes(subagentInfo.startedAt, subagentInfo.finishedAt))
		: toolCall.duration;

	return (
		<ErrorBorder isError={isError}>
			<div className="flex items-center gap-2 flex-wrap">
				{agentType && (
					<span className={`rounded px-1.5 py-0.5 text-xs font-medium ${colorClass}`}>{agentType}</span>
				)}
				{description && <span className="text-xs text-text-500">{description}</span>}
				{subagentInfo && statusBadge(subagentInfo.status)}
				{timingDuration !== undefined && timingDuration !== null && <DurationBadge duration={timingDuration} />}
				{linkAgentId && (
					<Link
						to="/session/$id"
						params={{id: linkAgentId}}
						className="inline-flex items-center gap-1 text-xs text-accent-100 hover:underline"
					>
						<Bot size={12} />
						View session
					</Link>
				)}
			</div>
			{subagentInfo?.startedAt && (
				<div className="text-[10px] text-text-500 mt-0.5">
					{new Date(subagentInfo.startedAt).toLocaleTimeString()}
					{subagentInfo.finishedAt && (
						<>
							{' '}
							→ {new Date(subagentInfo.finishedAt).toLocaleTimeString()}
							{durationFromTimes(subagentInfo.startedAt, subagentInfo.finishedAt) !== null && (
								<>
									{' '}
									(
									{formatDuration(
										durationFromTimes(subagentInfo.startedAt, subagentInfo.finishedAt)!,
									)}
									)
								</>
							)}
						</>
					)}
				</div>
			)}
			{prompt && (
				<div className="mt-2">
					<div className="text-[10px] uppercase tracking-wide text-text-500 mb-1">Prompt</div>
					<ExpandableBlock
						lineCount={promptLineCount}
						maxLines={6}
					>
						<blockquote className="border-l-2 border-border-300/40 pl-3 text-xs text-text-300 whitespace-pre-wrap break-words">
							{prompt}
						</blockquote>
					</ExpandableBlock>
				</div>
			)}
			{displayResult && (
				<div className="mt-3">
					<div className="text-[10px] uppercase tracking-wide text-text-500 mb-1">Output</div>
					<ExpandableBlock
						lineCount={outputLineCount}
						maxLines={20}
					>
						{looksLikeMarkdown(displayResult) ? (
							<div className="text-xs text-text-100 leading-relaxed">
								<MarkdownArticle markdown={displayResult} />
							</div>
						) : (
							<pre className="text-xs font-mono text-text-500 whitespace-pre-wrap break-all">
								{displayResult}
							</pre>
						)}
					</ExpandableBlock>
				</div>
			)}
		</ErrorBorder>
	);
}
