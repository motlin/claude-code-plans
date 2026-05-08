import {createFileRoute, Link} from '@tanstack/react-router';
import {useSuspenseQuery} from '@tanstack/react-query';
import {ArrowLeft, CheckCircle, Circle, Ban} from 'lucide-react';
import {projectDetailQueryOptions, projectTasksQueryOptions} from '../lib/api/projects';
import {DetailTopBar, pillStyles} from '../components/detail-top-bar';
import {DebugLink} from '../components/debug-link';
import {MarkdownInline, MarkdownView} from '../components/markdown-view';

export const Route = createFileRoute('/project/$id_/tasks')({
	component: ProjectTasksPage,
	loader: async ({context: {queryClient}, params}) => {
		const [detail] = await Promise.all([
			queryClient.ensureQueryData(projectDetailQueryOptions(params.id)),
			queryClient.ensureQueryData(projectTasksQueryOptions(params.id)),
		]);
		return detail;
	},
	head: ({loaderData}) => ({
		meta: [{title: loaderData ? `${loaderData.name} tasks` : 'Project Not Found'}],
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

function ProjectTasksPage() {
	const {id} = Route.useParams();
	const {data: project} = useSuspenseQuery(projectDetailQueryOptions(id));
	const {data: tasksData} = useSuspenseQuery(projectTasksQueryOptions(id));

	if (!project) {
		return (
			<div>
				<DetailTopBar>
					<Link
						to="/projects"
						className={pillStyles.primary}
					>
						<ArrowLeft className="h-3.5 w-3.5" />
						All Projects
					</Link>
				</DetailTopBar>
				<h1 className="mt-4 text-lg font-semibold">Project Not Found</h1>
			</div>
		);
	}

	const {todos, todoCounts} = tasksData;

	return (
		<div>
			<DetailTopBar>
				<Link
					to="/project/$id"
					params={{id: project.id}}
					className={pillStyles.primary}
				>
					<ArrowLeft className="h-3.5 w-3.5" />
					{project.name}
				</Link>
			</DetailTopBar>

			<h1 className="text-lg font-semibold">{project.name} tasks</h1>
			<p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-text-500">
				<span>{todoCounts.total} total</span>
				{todoCounts.pending > 0 && <span>{todoCounts.pending} pending</span>}
				{todoCounts.inProgress > 0 && (
					<span className="text-blue-500">{todoCounts.inProgress} in progress</span>
				)}
				{todoCounts.completed > 0 && <span className="text-green-500">{todoCounts.completed} completed</span>}
			</p>

			{todos.length === 0 ? (
				<p className="mt-4 text-text-500">No tasks for this project.</p>
			) : (
				<div className="mt-4 space-y-1">
					{todos.map((task) => (
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
										#{task.taskId} <MarkdownInline markdown={task.subject} />
									</span>
									<DebugLink
										kind="task"
										relativePath={`${task.projectDir}/${task.taskId}.json`}
									/>
								</div>
								{task.description && task.description !== task.subject && (
									<div className="mt-0.5 text-xs text-text-500">
										<MarkdownView markdown={task.description} />
									</div>
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
}
