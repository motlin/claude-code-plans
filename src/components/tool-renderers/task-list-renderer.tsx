import {List} from 'lucide-react';
import type {ToolRendererProps} from './types';
import {ErrorBorder, CollapsibleSection} from './shared';

export function TaskListRenderer({toolCall}: ToolRendererProps) {
	const result = toolCall.result ?? '';

	const taskLines = result.split('\n').filter((line) => line.match(/^#\d+/));
	const taskCount = taskLines.length || undefined;

	return (
		<ErrorBorder isError={toolCall.isError}>
			<div className="flex items-start gap-2">
				<List
					size={14}
					className="text-text-500 mt-0.5 shrink-0"
				/>
				<div className="min-w-0 flex-1">
					{taskCount !== undefined && (
						<div className="text-xs text-text-500">
							{taskCount} task{taskCount !== 1 ? 's' : ''}
						</div>
					)}
					{result && (
						<CollapsibleSection label={<span>Results</span>}>
							<pre className="text-xs text-text-500 whitespace-pre-wrap break-words leading-relaxed">
								{result}
							</pre>
						</CollapsibleSection>
					)}
				</div>
			</div>
		</ErrorBorder>
	);
}
