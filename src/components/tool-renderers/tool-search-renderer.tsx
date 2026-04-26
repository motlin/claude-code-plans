import type {ToolRendererProps} from './types';
import {ErrorBorder, KeyValueCard} from './shared';

export function ToolSearchRenderer({toolCall}: ToolRendererProps) {
	const query = (toolCall.input['query'] as string) ?? '';
	const maxResults = toolCall.input['max_results'] as number | undefined;
	const {result, isError} = toolCall;

	const params: Array<{key: string; value: string}> = [];
	if (query) params.push({key: 'query', value: query});
	if (maxResults !== undefined) params.push({key: 'max_results', value: String(maxResults)});

	return (
		<ErrorBorder isError={isError}>
			<KeyValueCard
				params={params}
				result={result ?? undefined}
			/>
		</ErrorBorder>
	);
}
