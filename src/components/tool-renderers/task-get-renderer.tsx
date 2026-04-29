import type {ToolRendererProps} from './types';
import {ErrorBorder, KeyValueCard} from './shared';

export function TaskGetRenderer({toolCall}: ToolRendererProps) {
	const taskId = (toolCall.input['taskId'] as string) ?? '';

	const params: Array<{key: string; value: string}> = [];
	if (taskId) params.push({key: 'taskId', value: `#${taskId}`});

	return (
		<ErrorBorder isError={toolCall.isError}>
			<KeyValueCard
				params={params}
				result={toolCall.result ?? undefined}
			/>
		</ErrorBorder>
	);
}
