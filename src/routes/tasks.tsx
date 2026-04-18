import {createFileRoute} from '@tanstack/react-router';
import {useSuspenseQuery} from '@tanstack/react-query';
import {useState} from 'react';
import {ChevronRight, CheckCircle, Circle, Ban, List, GitBranch} from 'lucide-react';
import styles from '../components/markdown-article.module.css';
import {tasksQueryOptions} from '../queries/tasks';
import {TaskDependencyGraph} from '../components/task-dependency-graph';
import {DebugLink} from '../components/debug-link';

export const Route = createFileRoute('/tasks')({
	component: TasksPage,
	loader: ({context: {queryClient}}) => queryClient.ensureQueryData(tasksQueryOptions),
	head: () => ({
		meta: [{title: 'Tasks'}],
	}),
});

const statusBadgeClasses: Record<string, string> = {
	pending: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
	in_progress: 'bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400',
	completed: 'bg-green-50 text-green-600 dark:bg-green-950/30 dark:text-green-400',
};

const statusLabel: Record<string, string> = {
	pending: 'Pending',
	in_progress: 'In Progress',
	completed: 'Completed',
};

type View = 'list' | 'graph';

function TasksPage() {
	const {data: groups} = useSuspenseQuery(tasksQueryOptions);
	const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
	const [view, setView] = useState<View>('list');

	function toggleGroup(projectDir: string) {
		setCollapsed((prev) => {
			const next = new Set(prev);
			if (next.has(projectDir)) {
				next.delete(projectDir);
			} else {
				next.add(projectDir);
			}
			return next;
		});
	}

	return (
		<div>
			<div className="flex items-center justify-between">
				<h1 className="text-lg font-semibold">Tasks</h1>
				<div className="flex items-center gap-1 rounded-md border border-border-300/30 p-0.5">
					<button
						type="button"
						onClick={() => setView('list')}
						className={`rounded px-2 py-1 text-xs transition-colors ${view === 'list' ? 'bg-bg-200 text-text-100' : 'text-text-500 hover:text-text-300'}`}
						title="List view"
					>
						<List className="h-3.5 w-3.5" />
					</button>
					<button
						type="button"
						onClick={() => setView('graph')}
						className={`rounded px-2 py-1 text-xs transition-colors ${view === 'graph' ? 'bg-bg-200 text-text-100' : 'text-text-500 hover:text-text-300'}`}
						title="Dependency graph"
					>
						<GitBranch className="h-3.5 w-3.5" />
					</button>
				</div>
			</div>

			{groups.length === 0 ? (
				<p className="mt-4 text-text-500">No incomplete tasks across any projects.</p>
			) : view === 'graph' ? (
				<TaskDependencyGraph groups={groups} />
			) : (
				<div className="mt-6 space-y-4">
					{groups.map((group) => {
						const isCollapsed = collapsed.has(group.projectDir);
						return (
							<div key={group.projectDir}>
								<button
									type="button"
									onClick={() => toggleGroup(group.projectDir)}
									className="flex w-full items-center gap-2 border-b border-border-300/15 pb-1 cursor-pointer"
								>
									<ChevronRight
										className="h-3 w-3 text-text-500 transition-transform duration-200"
										style={{transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)'}}
									/>
									<span className="text-sm font-semibold">{group.projectDir}</span>
									<span className="flex items-center gap-2 text-xs text-text-500">
										{group.totalPending > 0 && (
											<span className="flex items-center gap-1">
												<Circle className="h-3 w-3" /> {group.totalPending} pending
											</span>
										)}
										{group.totalInProgress > 0 && (
											<span className="flex items-center gap-1 text-blue-500">
												<Circle className="h-3 w-3" /> {group.totalInProgress} in progress
											</span>
										)}
									</span>
								</button>
								{!isCollapsed && (
									<div className="mt-2 space-y-1">
										{group.tasks.map((task) => (
											<div
												key={task.taskId}
												className="flex items-start gap-2 rounded-md p-2"
											>
												{task.status === 'completed' ? (
													<CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
												) : (
													<Circle
														className={`mt-0.5 h-4 w-4 shrink-0 ${task.status === 'in_progress' ? 'text-blue-500' : 'text-text-500'}`}
													/>
												)}
												<div className="min-w-0 flex-1">
													<div className="text-sm text-text-100 flex items-center gap-1.5">
														<span>
															#{task.taskId}{' '}
															<span
																dangerouslySetInnerHTML={{__html: task.subjectHtml}}
															/>
														</span>
														<DebugLink
															kind="task"
															relativePath={`${group.projectDir}/${task.taskId}.json`}
														/>
													</div>
													{task.description && task.description !== task.subject && (
														<div
															className={`mt-0.5 text-xs text-text-500 ${styles['markdown']}`}
															dangerouslySetInnerHTML={{__html: task.descriptionHtml}}
														/>
													)}
													<div className="mt-0.5 flex items-center gap-2">
														<span
															className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${statusBadgeClasses[task.status] ?? ''}`}
														>
															{statusLabel[task.status] ?? task.status}
														</span>
														{task.blockedBy.length > 0 && (
															<span className="flex items-center gap-1 text-[10px] text-orange-500">
																<Ban className="h-3 w-3" />
																blocked by #{task.blockedBy.join(', #')}
															</span>
														)}
													</div>
												</div>
											</div>
										))}
									</div>
								)}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
