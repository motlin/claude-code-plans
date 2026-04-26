import {Link} from '@tanstack/react-router';
import {Bot} from 'lucide-react';
import type {ToolRendererProps} from './types';
import {ErrorBorder, ExpandableBlock} from './shared';

export function AgentRenderer({toolCall}: ToolRendererProps) {
	const prompt = (toolCall.input['prompt'] as string) ?? '';
	const agentType = (toolCall.input['subagent_type'] as string) ?? '';
	const description = (toolCall.input['description'] as string) ?? '';
	const {result, isError, subagentInfo} = toolCall;

	const agentIdMatch = result?.match(/agentId:\s*(\S+)/);
	const fallbackAgentId = agentIdMatch?.[1];
	const displayResult = fallbackAgentId ? result!.replace(/agentId:\s*\S+\n?/, '').trim() : result;

	const linkAgentId = subagentInfo?.agentId ?? (fallbackAgentId ? `agent-${fallbackAgentId}` : null);

	// Build key: value pairs for input params, matching claude.ai/code's display
	const params: Array<{key: string; value: string}> = [];
	if (description) params.push({key: 'description', value: description});
	if (prompt) params.push({key: 'prompt', value: prompt});
	if (agentType) params.push({key: 'subagent_type', value: agentType});

	const resultLineCount = displayResult?.trim() ? displayResult.trim().split('\n').length : 0;

	return (
		<ErrorBorder isError={isError}>
			<div className="flex flex-col gap-[5px] text-[13px] text-text-500 whitespace-pre-wrap break-words">
				{params.length > 0 && (
					<div className="text-text-500">
						{params.map((p) => (
							<div key={p.key}>
								{p.key}: {p.value}
							</div>
						))}
					</div>
				)}
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
				{displayResult && (
					<ExpandableBlock
						lineCount={resultLineCount}
						maxLines={20}
					>
						<div className="whitespace-pre-wrap break-words">{displayResult}</div>
					</ExpandableBlock>
				)}
			</div>
		</ErrorBorder>
	);
}
