import {ListTodo} from 'lucide-react';
import type {ToolRendererProps} from './types';
import {ErrorBorder} from './shared';

export function TodoWriteRenderer({toolCall}: ToolRendererProps) {
	const todos = toolCall.input['todos'] as unknown[];
	const count = Array.isArray(todos) ? todos.length : 0;

	return (
		<ErrorBorder isError={toolCall.isError}>
			<div className="flex items-center gap-1.5">
				<ListTodo
					size={14}
					className="text-accent-100 shrink-0"
				/>
				{count > 0 && (
					<span className="text-xs text-text-500">
						({count} {count === 1 ? 'item' : 'items'})
					</span>
				)}
			</div>
		</ErrorBorder>
	);
}
