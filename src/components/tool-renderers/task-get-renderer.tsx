import {Eye} from 'lucide-react';
import type {ToolRendererProps} from './types';
import {ErrorBorder} from './shared';

export function TaskGetRenderer({toolCall}: ToolRendererProps) {
	// Try to parse subject and status from the result
	const result = toolCall.result ?? '';
	const subjectMatch = result.match(/subject:\s*(.+?)(?:\n|$)/i) ?? result.match(/^Task #\d+:\s*(.+?)(?:\n|$)/);
	const statusMatch = result.match(/status:\s*(\w+)/i);
	const subject = subjectMatch?.[1]?.trim();
	const status = statusMatch?.[1];

	return (
		<ErrorBorder isError={toolCall.isError}>
			<div className="flex items-start gap-2">
				<Eye
					size={14}
					className="text-text-500 mt-0.5 shrink-0"
				/>
				<div className="min-w-0">
					{status && <div className="text-xs text-text-500">({status.replace('_', ' ')})</div>}
					{subject && <div className="text-xs text-text-100 mt-0.5">{subject}</div>}
				</div>
			</div>
		</ErrorBorder>
	);
}
