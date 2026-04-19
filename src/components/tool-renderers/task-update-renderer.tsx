import {CheckCircle, Circle, Loader, Pencil, Trash2} from 'lucide-react';
import type {ToolRendererProps} from './types';
import {ErrorBorder} from './shared';

type StatusConfig = {icon: typeof Circle; color: string; label: string; spin?: boolean};

const STATUS_CONFIG: Record<string, StatusConfig> = {
	pending: {icon: Circle, color: 'text-text-500', label: 'Pending'},
	in_progress: {icon: Loader, color: 'text-accent-100', label: 'In Progress', spin: true},
	completed: {icon: CheckCircle, color: 'text-success-000', label: 'Completed'},
	deleted: {icon: Trash2, color: 'text-danger-000', label: 'Deleted'},
};

export function TaskUpdateRenderer({toolCall}: ToolRendererProps) {
	const taskId = (toolCall.input['taskId'] as string) ?? (toolCall.input['task_id'] as string) ?? '';
	const status = (toolCall.input['status'] as string) ?? '';
	const subject = (toolCall.input['subject'] as string) ?? '';
	const description = (toolCall.input['description'] as string) ?? '';
	const activeForm = (toolCall.input['activeForm'] as string) ?? '';

	const config = STATUS_CONFIG[status];
	const Icon = config?.icon ?? Pencil;
	const iconColor = config?.color ?? 'text-text-500';
	const spin = config?.spin ?? false;

	// Determine action label
	const actionLabel = config?.label ?? 'Update';

	return (
		<ErrorBorder isError={toolCall.isError}>
			<div className="flex items-start gap-2">
				<Icon
					size={14}
					className={`${iconColor} mt-0.5 shrink-0 ${spin ? 'animate-spin' : ''}`}
				/>
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<span className="text-xs font-medium">{actionLabel}</span>
						{taskId && <span className="text-xs text-text-500 font-mono">#{taskId}</span>}
					</div>
					{subject && <div className="text-xs font-medium text-text-100 mt-0.5">{subject}</div>}
					{activeForm && !subject && <div className="text-xs text-text-500 mt-0.5 italic">{activeForm}</div>}
					{description && <div className="text-xs text-text-500 mt-0.5 line-clamp-2">{description}</div>}
				</div>
			</div>
		</ErrorBorder>
	);
}
