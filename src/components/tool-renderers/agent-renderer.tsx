import type {ToolRendererProps} from './types';
import {ErrorBorder, KeyValueCard} from './shared';

export function AgentRenderer({toolCall}: ToolRendererProps) {
	const prompt = (toolCall.input['prompt'] as string) ?? '';
	const agentType = (toolCall.input['subagent_type'] as string) ?? '';
	const description = (toolCall.input['description'] as string) ?? '';
	const {result, isError} = toolCall;

	const agentIdMatch = result?.match(/agentId:\s*(\S+)/);
	const displayResult = agentIdMatch?.[1] ? result!.replace(/agentId:\s*\S+\n?/, '').trim() : result;

	const params: Array<{key: string; value: string}> = [];
	if (description) params.push({key: 'description', value: description});
	if (prompt) params.push({key: 'prompt', value: prompt});
	if (agentType) params.push({key: 'subagent_type', value: agentType});

	return (
		<ErrorBorder isError={isError}>
			<KeyValueCard
				params={params}
				result={displayResult ?? undefined}
			/>
		</ErrorBorder>
	);
}
