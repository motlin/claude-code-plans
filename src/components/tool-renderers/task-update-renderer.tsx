import {CheckCircle, Circle, Loader} from 'lucide-react';
import type {ToolRendererProps} from './types';

const STATUS_CONFIG: Record<string, {icon: typeof Circle; color: string; spin?: boolean}> = {
	pending: {icon: Circle, color: 'text-text-500'},
	in_progress: {icon: Loader, color: 'text-accent-100', spin: true},
	completed: {icon: CheckCircle, color: 'text-success-000'},
};

export function TaskUpdateRenderer({toolCall}: ToolRendererProps) {
	const taskId = (toolCall.input['taskId'] as string) ?? (toolCall.input['task_id'] as string) ?? '';
	const status = (toolCall.input['status'] as string) ?? '';
	const config = STATUS_CONFIG[status] ?? STATUS_CONFIG['pending']!;
	const Icon = config.icon;

	return (
		<div className="flex items-center gap-1.5">
			<Icon
				size={14}
				className={`${config.color} ${config.spin ? 'animate-spin' : ''}`}
			/>
			<span className="text-xs">
				Task #{taskId} <span className="text-text-500">{status}</span>
			</span>
		</div>
	);
}
