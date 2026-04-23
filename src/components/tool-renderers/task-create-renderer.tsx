import {PlusCircle} from 'lucide-react';
import type {ToolRendererProps} from './types';
import {ErrorBorder} from './shared';

export function TaskCreateRenderer({toolCall}: ToolRendererProps) {
	const subject = (toolCall.input['subject'] as string) ?? '';
	const description = (toolCall.input['description'] as string) ?? '';
	const status = (toolCall.input['status'] as string) ?? 'pending';

	// Parse created task ID from result (e.g. "Created task #5")
	const createdId = toolCall.result?.match(/#(\d+)/)?.[1];

	return (
		<ErrorBorder isError={toolCall.isError}>
			<div className="flex items-start gap-2">
				<PlusCircle
					size={14}
					className="text-accent-100 mt-0.5 shrink-0"
				/>
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						{createdId && <span className="text-xs text-text-500 font-mono">#{createdId}</span>}
						{status !== 'pending' && (
							<span className="text-xs text-text-500">({status.replace('_', ' ')})</span>
						)}
					</div>
					{subject && <div className="text-xs font-medium text-text-100 mt-0.5">{subject}</div>}
					{description && <div className="text-xs text-text-500 mt-0.5 line-clamp-3">{description}</div>}
				</div>
			</div>
		</ErrorBorder>
	);
}
