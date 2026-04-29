import type {ToolRendererProps} from './types';
import {ErrorBorder, KeyValueCard} from './shared';

export function WebFetchRenderer({toolCall}: ToolRendererProps) {
	const url = (toolCall.input['url'] as string) ?? '';
	const prompt = toolCall.input['prompt'] as string | undefined;
	const offset = toolCall.input['offset'] as number | undefined;
	const {result, isError} = toolCall;

	const params: Array<{key: string; value: string}> = [];
	if (url) params.push({key: 'url', value: url});
	if (prompt) params.push({key: 'prompt', value: prompt});
	if (offset !== undefined) params.push({key: 'offset', value: String(offset)});

	return (
		<ErrorBorder isError={isError}>
			<KeyValueCard
				params={params}
				result={result ?? undefined}
			/>
		</ErrorBorder>
	);
}
