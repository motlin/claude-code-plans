import {CheckCircle, Circle} from 'lucide-react';
import type {ClientToolCall} from './tool-renderers/types';

interface TaskItem {
	id: string;
	subject: string;
	description: string;
	status: 'pending' | 'in_progress' | 'completed';
}

export function extractTasks(toolCalls: ClientToolCall[]): TaskItem[] {
	const tasks = new Map<string, TaskItem>();
	let autoId = 0;

	for (const call of toolCalls) {
		if (call.name === 'TaskCreate') {
			autoId++;
			const id = String(autoId);
			tasks.set(id, {
				id,
				subject: (call.input['subject'] as string) ?? `Task ${id}`,
				description: (call.input['description'] as string) ?? '',
				status: 'pending',
			});
		} else if (call.name === 'TaskUpdate') {
			const taskId = call.input['taskId'] as string | undefined;
			if (taskId && tasks.has(taskId)) {
				const existing = tasks.get(taskId)!;
				const newStatus = call.input['status'] as string | undefined;
				if (newStatus === 'pending' || newStatus === 'in_progress' || newStatus === 'completed') {
					existing.status = newStatus;
				}
			}
		}
	}

	return Array.from(tasks.values());
}

const statusBadgeClasses: Record<TaskItem['status'], string> = {
	pending: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
	in_progress: 'bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400',
	completed: 'bg-green-50 text-green-600 dark:bg-green-950/30 dark:text-green-400',
};

const statusLabel: Record<TaskItem['status'], string> = {
	pending: 'Pending',
	in_progress: 'In Progress',
	completed: 'Completed',
};

export function TasksView({toolCalls}: {toolCalls: ClientToolCall[]}) {
	const tasks = extractTasks(toolCalls);

	if (tasks.length === 0) return null;

	const completed = tasks.filter((t) => t.status === 'completed').length;
	const inProgress = tasks.filter((t) => t.status === 'in_progress').length;
	const pending = tasks.filter((t) => t.status === 'pending').length;

	return (
		<div>
			<div className="flex items-center gap-4 mb-3 text-sm">
				<span className="text-text-000">
					<span className="font-medium">{tasks.length}</span> tasks
				</span>
				{completed > 0 && (
					<span className="text-green-600 flex items-center gap-1">
						<CheckCircle className="h-3 w-3" /> {completed} completed
					</span>
				)}
				{inProgress > 0 && (
					<span className="text-blue-600 flex items-center gap-1">
						<Circle className="h-3 w-3" /> {inProgress} in progress
					</span>
				)}
				{pending > 0 && (
					<span className="text-text-500 flex items-center gap-1">
						<Circle className="h-3 w-3" /> {pending} pending
					</span>
				)}
			</div>

			<div className="space-y-2">
				{tasks.map((task) => (
					<div
						key={task.id}
						className="border border-border-300/15 rounded-lg overflow-hidden"
					>
						<div className="px-3 py-2">
							<div className="flex items-center gap-2">
								<span className="text-xs text-text-500 font-mono">#{task.id}</span>
								<span
									className={`px-2 py-0.5 rounded text-xs font-medium ${statusBadgeClasses[task.status]}`}
								>
									{statusLabel[task.status]}
								</span>
							</div>
							<h3 className="text-sm font-medium text-text-000 mt-1 truncate">{task.subject}</h3>
							{task.description && (
								<p className="text-xs text-text-500 mt-0.5 line-clamp-2">{task.description}</p>
							)}
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
