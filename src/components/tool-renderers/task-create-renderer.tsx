import {PlusCircle} from 'lucide-react';
import type {ToolRendererProps} from './types';

export function TaskCreateRenderer({toolCall}: ToolRendererProps) {
	const subject = (toolCall.input['subject'] as string) ?? '';
	const description = (toolCall.input['description'] as string) ?? '';

	return (
		<div className="flex items-start gap-1.5">
			<PlusCircle
				size={14}
				className="text-muted-foreground mt-0.5 shrink-0"
			/>
			<div>
				<span className="text-xs text-muted-foreground">New Task</span>
				<div className="text-xs font-medium">{subject}</div>
				{description && <div className="text-xs text-muted-foreground">{description}</div>}
			</div>
		</div>
	);
}
