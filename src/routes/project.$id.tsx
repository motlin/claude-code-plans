import {createFileRoute, Link} from '@tanstack/react-router';
import {useSuspenseQuery} from '@tanstack/react-query';
import {
	ArrowLeft,
	ArrowRight,
	Brain,
	Bot,
	CheckSquare,
	CheckCircle,
	Circle,
	FileText,
	MessageSquare,
} from 'lucide-react';
import type {ComponentType, SVGProps} from 'react';
import {
	projectDetailQueryOptions,
	projectSessionsQueryOptions,
	projectPlansQueryOptions,
	projectTasksQueryOptions,
} from '../lib/api/projects';
import {projectMemoriesQueryOptions} from '../lib/api/memories';
import {DetailTopBar, pillStyles} from '../components/detail-top-bar';

export const Route = createFileRoute('/project/$id')({
	component: ProjectPage,
	loader: async ({context: {queryClient}, params}) => {
		const [detail] = await Promise.all([
			queryClient.ensureQueryData(projectDetailQueryOptions(params.id)),
			queryClient.ensureQueryData(projectSessionsQueryOptions(params.id)),
			queryClient.ensureQueryData(projectPlansQueryOptions(params.id)),
			queryClient.ensureQueryData(projectTasksQueryOptions(params.id)),
			queryClient.ensureQueryData(projectMemoriesQueryOptions(params.id)),
		]);
		return detail;
	},
	head: ({loaderData}) => ({
		meta: [{title: loaderData?.name ?? 'Project Not Found'}],
	}),
});

function formatDate(iso: string): string {
	return new Date(iso).toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	});
}

interface NavCardProps {
	to: string;
	params: {id: string};
	icon: ComponentType<SVGProps<SVGSVGElement>>;
	label: string;
	count: number;
	hint?: string;
}

function NavCard({to, params, icon: Icon, label, count, hint}: NavCardProps) {
	return (
		<Link
			to={to}
			params={params}
			className="group flex items-center justify-between rounded-md border border-border-300/15 px-4 py-3 transition-colors hover:bg-bg-200/50"
		>
			<div className="flex items-center gap-3">
				<Icon className="h-4 w-4 text-text-500" />
				<div>
					<div className="text-sm font-medium">{label}</div>
					{hint && <div className="text-xs text-text-500">{hint}</div>}
				</div>
			</div>
			<div className="flex items-center gap-2 text-text-500">
				<span className="text-sm">{count}</span>
				<ArrowRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
			</div>
		</Link>
	);
}

function ProjectPage() {
	const {id} = Route.useParams();
	const {data: detail} = useSuspenseQuery(projectDetailQueryOptions(id));
	const {data: sessions} = useSuspenseQuery(projectSessionsQueryOptions(id));
	const {data: plans} = useSuspenseQuery(projectPlansQueryOptions(id));
	const {data: tasksData} = useSuspenseQuery(projectTasksQueryOptions(id));
	const {data: memoriesData} = useSuspenseQuery(projectMemoriesQueryOptions(id));

	if (!detail) {
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
				<p className="mt-2 text-text-500">This project could not be found.</p>
			</div>
		);
	}

	const memories = memoriesData?.memories ?? [];
	const {todos, todoCounts} = tasksData;
	const planCount = new Set(plans.map((p) => p.filename)).size;
	const taskHint =
		todoCounts.inProgress > 0
			? `${todoCounts.inProgress} in progress, ${todoCounts.pending} pending`
			: todoCounts.pending > 0
				? `${todoCounts.pending} pending`
				: todoCounts.completed > 0
					? `${todoCounts.completed} completed`
					: undefined;

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

			<h1 className="text-lg font-semibold">{detail.name}</h1>
			{detail.projectPath && <p className="mt-0.5 text-xs text-text-500">{detail.projectPath}</p>}

			{/* Sub-route nav cards */}
			<div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
				<NavCard
					to="/project/$id/sessions"
					params={{id: detail.id}}
					icon={MessageSquare}
					label="Sessions"
					count={sessions.length}
				/>
				<NavCard
					to="/project/$id/tasks"
					params={{id: detail.id}}
					icon={CheckSquare}
					label="Tasks"
					count={todoCounts.total}
					{...(taskHint ? {hint: taskHint} : {})}
				/>
				<NavCard
					to="/project/$id/memories"
					params={{id: detail.id}}
					icon={Brain}
					label="Memories"
					count={memories.length}
				/>
				<NavCard
					to="/project/$id/plans"
					params={{id: detail.id}}
					icon={FileText}
					label="Plans"
					count={planCount}
				/>
				{detail.subagentCount > 0 && (
					<NavCard
						to="/project/$id/subagents"
						params={{id: detail.id}}
						icon={Bot}
						label="Subagents"
						count={detail.subagentCount}
					/>
				)}
			</div>

			{/* Sessions */}
			<section className="mt-8">
				<h2 className="border-b border-border-300/15 pb-1 text-sm font-semibold">
					Sessions ({sessions.length})
				</h2>
				{sessions.length === 0 ? (
					<p className="mt-2 text-sm text-text-500">No sessions.</p>
				) : (
					<ul className="mt-2 space-y-1">
						{sessions.map((sess) => (
							<li key={sess.id}>
								<Link
									to="/session/$id"
									params={{id: sess.id}}
									className="block rounded-md p-2 cursor-pointer transition-colors hover:bg-bg-200/50"
								>
									<div
										className="truncate"
										style={{fontSize: '14px', fontWeight: 430}}
									>
										{sess.title}
									</div>
									<div className="mt-0.5 flex items-center gap-2 text-xs text-text-500">
										<span>{formatDate(sess.mtime)}</span>
										{sess.messageCount > 0 && (
											<>
												<span>&middot;</span>
												<span>{sess.messageCount} msgs</span>
											</>
										)}
										{sess.subagentCount > 0 && (
											<>
												<span>&middot;</span>
												<span>
													{sess.subagentCount} subagent
													{sess.subagentCount !== 1 ? 's' : ''}
												</span>
											</>
										)}
										{sess.gitBranch && (
											<>
												<span>&middot;</span>
												<span className="rounded bg-bg-200 px-1.5 py-0.5 font-mono text-[10px]">
													{sess.gitBranch}
												</span>
											</>
										)}
									</div>
									{sess.summary && sess.summary !== sess.title && (
										<div className="mt-0.5 truncate text-xs text-text-500 italic">
											{sess.summary}
										</div>
									)}
								</Link>
							</li>
						))}
					</ul>
				)}
			</section>

			{/* Subagents */}
			{detail.subagentCount > 0 && (
				<section className="mt-8">
					<h2 className="border-b border-border-300/15 pb-1 text-sm font-semibold">
						Subagents ({detail.subagentCount})
					</h2>
					<div className="mt-2">
						<Link
							to="/project/$id/subagents"
							params={{id}}
							className="text-xs text-accent-100 hover:underline inline-flex items-center gap-1"
						>
							<Bot className="h-3 w-3" />
							View all subagents
						</Link>
					</div>
				</section>
			)}

			{/* Tasks */}
			{todos.length > 0 && (
				<section className="mt-8">
					<h2 className="border-b border-border-300/15 pb-1 text-sm font-semibold">
						Tasks ({todoCounts.total})
						{todoCounts.pending > 0 && (
							<span className="ml-2 text-xs font-normal text-text-500">{todoCounts.pending} pending</span>
						)}
						{todoCounts.inProgress > 0 && (
							<span className="ml-2 text-xs font-normal text-blue-500">
								{todoCounts.inProgress} in progress
							</span>
						)}
					</h2>
					<div className="mt-2 space-y-1">
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
									<div className="text-sm text-text-100">
										#{task.taskId} <span dangerouslySetInnerHTML={{__html: task.subjectHtml}} />
									</div>
									{task.blockedBy.length > 0 && (
										<div className="mt-0.5 text-[10px] text-orange-500">
											blocked by #{task.blockedBy.join(', #')}
										</div>
									)}
								</div>
							</div>
						))}
					</div>
				</section>
			)}

			{/* Memories */}
			<section className="mt-8">
				<h2 className="border-b border-border-300/15 pb-1 text-sm font-semibold">
					Memories ({memories.length})
				</h2>
				{memories.length === 0 ? (
					<p className="mt-2 text-sm text-text-500">No memories.</p>
				) : (
					<ul className="mt-2 space-y-1">
						{memories.map((mem) => (
							<li key={mem.filename}>
								<Link
									to="/memory/$project/$filename"
									params={{project: mem.project, filename: mem.filename}}
									className="block rounded-md p-2 cursor-pointer transition-colors hover:bg-bg-200/50"
								>
									<div
										className="truncate"
										style={{fontSize: '14px', fontWeight: 430}}
									>
										{mem.title}
									</div>
									<div className="mt-0.5 text-xs text-text-500">{formatDate(mem.mtime)}</div>
								</Link>
							</li>
						))}
					</ul>
				)}
			</section>

			{/* Linked Plans */}
			{plans.length > 0 && (
				<section className="mt-8">
					<h2 className="border-b border-border-300/15 pb-1 text-sm font-semibold">
						Linked Plans ({plans.length})
					</h2>
					<ul className="mt-2 space-y-1">
						{plans.map((plan) => (
							<li key={plan.filename}>
								<Link
									to="/plan/$filename"
									params={{filename: plan.filename}}
									className="block rounded-md p-2 cursor-pointer transition-colors hover:bg-bg-200/50"
								>
									<div
										className="truncate"
										style={{fontSize: '14px', fontWeight: 430}}
									>
										{plan.title}
									</div>
								</Link>
							</li>
						))}
					</ul>
				</section>
			)}
		</div>
	);
}
