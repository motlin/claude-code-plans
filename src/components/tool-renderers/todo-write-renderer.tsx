import type {ToolRendererProps} from './types';
import {ErrorBorder, KeyValueCard} from './shared';

export function TodoWriteRenderer({toolCall}: ToolRendererProps) {
	const todos = toolCall.input['todos'] as unknown[];
	const count = Array.isArray(todos) ? todos.length : 0;

	const params: Array<{key: string; value: string}> = [];
	if (count > 0) {
		params.push({key: 'todos', value: `${count} ${count === 1 ? 'item' : 'items'}`});
	}

	return (
		<ErrorBorder isError={toolCall.isError}>
			<KeyValueCard
				params={params}
				result={toolCall.result ?? undefined}
			/>
		</ErrorBorder>
	);
}
