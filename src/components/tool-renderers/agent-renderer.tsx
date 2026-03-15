import {Link} from '@tanstack/react-router';
import {Bot} from 'lucide-react';
import {MarkdownArticle} from '../markdown-article';
import type {ToolRendererProps} from './types';
import {CollapsibleSection, DurationBadge, ErrorBorder} from './shared';

const AGENT_TYPE_COLORS: Record<string, string> = {
	Explore: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
	Plan: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
	Code: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
	Research: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300',
	'general-purpose': 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
	'markdown-tasks': 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
	build: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
};

export function AgentRenderer({toolCall}: ToolRendererProps) {
	const prompt = (toolCall.input['prompt'] as string) ?? '';
	const agentType = (toolCall.input['subagent_type'] as string) ?? '';
	const description = (toolCall.input['description'] as string) ?? '';
	const {result, isError} = toolCall;

	const agentIdMatch = result?.match(/agentId:\s*(\S+)/);
	const agentId = agentIdMatch?.[1];
	const displayResult = agentId ? result!.replace(/agentId:\s*\S+\n?/, '').trim() : result;
	const promptPreview = prompt.split('\n')[0]?.slice(0, 80) ?? '';

	const colorClass = AGENT_TYPE_COLORS[agentType] ?? 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300';

	return (
		<ErrorBorder isError={isError}>
			<div className="flex items-center gap-2 flex-wrap">
				{agentType && (
					<span className={`rounded px-1.5 py-0.5 text-xs font-medium ${colorClass}`}>{agentType}</span>
				)}
				{description && <span className="text-xs text-text-500">{description}</span>}
				{!description && promptPreview && (
					<span className="text-xs text-text-500 truncate">{promptPreview}</span>
				)}
				{toolCall.duration !== undefined && <DurationBadge duration={toolCall.duration} />}
				{agentId && (
					<Link
						to="/session/$id"
						params={{id: `agent-${agentId}`}}
						className="inline-flex items-center gap-1 text-xs text-accent-100 hover:underline"
					>
						<Bot size={12} />
						View session
					</Link>
				)}
			</div>
			{prompt && (
				<CollapsibleSection label="Prompt">
					<pre className="text-xs font-mono text-text-500 whitespace-pre-wrap break-all max-h-48 overflow-auto">
						{prompt}
					</pre>
				</CollapsibleSection>
			)}
			{displayResult && (
				<CollapsibleSection
					label="Output"
					defaultOpen={!!isError}
				>
					{toolCall.resultHtml ? (
						<div className="text-xs text-text-100 leading-relaxed max-h-48 overflow-auto">
							<MarkdownArticle html={toolCall.resultHtml} />
						</div>
					) : (
						<pre className="text-xs font-mono text-text-500 whitespace-pre-wrap break-all max-h-48 overflow-auto">
							{displayResult}
						</pre>
					)}
				</CollapsibleSection>
			)}
		</ErrorBorder>
	);
}
