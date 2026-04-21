import {StopCircle} from 'lucide-react';
import type {ToolRendererProps} from './types';
import {ErrorBorder} from './shared';

export function TaskStopRenderer({toolCall}: ToolRendererProps) {
	const taskId = (toolCall.input['task_id'] as string) ?? '';

	return (
		<ErrorBorder isError={toolCall.isError}>
			<div className="flex items-center gap-2">
				<StopCircle
					size={14}
					className="text-danger-000 shrink-0"
				/>
				<span className="text-xs font-medium">Stop Task</span>
				{taskId && <span className="text-xs text-text-500 font-mono">#{taskId}</span>}
			</div>
		</ErrorBorder>
	);
}
