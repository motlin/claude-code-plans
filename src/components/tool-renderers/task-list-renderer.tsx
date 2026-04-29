import type {ToolRendererProps} from './types';
import {ErrorBorder, KeyValueCard} from './shared';

export function TaskListRenderer({toolCall}: ToolRendererProps) {
	return (
		<ErrorBorder isError={toolCall.isError}>
			<KeyValueCard
				params={[]}
				result={toolCall.result ?? undefined}
			/>
		</ErrorBorder>
	);
}
