import type {ToolRendererProps} from './types';
import {ErrorBorder, KeyValueCard} from './shared';

export function McpRenderer({toolCall}: ToolRendererProps) {
	const {input, result, isError} = toolCall;
	const entries = Object.entries(input).filter(([k]) => k !== 'type');

	const params = entries.map(([key, value]) => ({
		key,
		value: typeof value === 'string' ? value : JSON.stringify(value),
	}));

	return (
		<ErrorBorder isError={isError}>
			<KeyValueCard
				params={params}
				result={result ?? undefined}
			/>
		</ErrorBorder>
	);
}
