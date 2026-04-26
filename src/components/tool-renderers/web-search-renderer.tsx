import type {ToolRendererProps} from './types';
import {ErrorBorder, KeyValueCard} from './shared';

export function WebSearchRenderer({toolCall}: ToolRendererProps) {
	const query = (toolCall.input['query'] as string) ?? '';
	const allowedDomains = toolCall.input['allowed_domains'] as string[] | undefined;
	const {result, isError} = toolCall;

	const params: Array<{key: string; value: string}> = [];
	if (query) params.push({key: 'query', value: query});
	if (allowedDomains && allowedDomains.length > 0) {
		params.push({key: 'allowed_domains', value: allowedDomains.join(', ')});
	}

	return (
		<ErrorBorder isError={isError}>
			<KeyValueCard
				params={params}
				result={result ?? undefined}
			/>
		</ErrorBorder>
	);
}
