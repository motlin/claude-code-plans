import type {ToolRendererProps} from './types';
import {ErrorBorder, KeyValueCard} from './shared';

export function TaskListRenderer({toolCall}: ToolRendererProps) {
	const params: Array<{key: string; value: string}> = [];

	return (
		<ErrorBorder isError={toolCall.isError}>
			<KeyValueCard
				params={params}
				result={toolCall.result ?? undefined}
			/>
		</ErrorBorder>
	);
}
