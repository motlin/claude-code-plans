import type {ToolRendererProps} from './types';
import {ErrorBorder, KeyValueCard} from './shared';

export function EnterPlanModeRenderer({toolCall}: ToolRendererProps) {
	const {result} = toolCall;

	return (
		<ErrorBorder isError={toolCall.isError}>
			<KeyValueCard
				params={[]}
				result={result && result !== 'success' ? result : undefined}
			/>
		</ErrorBorder>
	);
}
