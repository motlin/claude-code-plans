import {StopCircle} from 'lucide-react';
import type {ToolRendererProps} from './types';
import {ErrorBorder} from './shared';

export function TaskStopRenderer({toolCall}: ToolRendererProps) {
	return (
		<ErrorBorder isError={toolCall.isError}>
			<StopCircle
				size={14}
				className="text-danger-000 shrink-0"
			/>
		</ErrorBorder>
	);
}
