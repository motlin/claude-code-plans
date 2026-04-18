import {createFileRoute, Link} from '@tanstack/react-router';
import {useSuspenseQuery} from '@tanstack/react-query';
import {ArrowLeft, CheckCircle, Circle} from 'lucide-react';
import {projectQueryOptions} from '../queries/projects';
import {DetailTopBar, pillStyles} from '../components/detail-top-bar';
import {SubagentTree} from '../components/subagent-tree';

export const Route = createFileRoute('/project/$id')({
	component: ProjectPage,
	loader: ({context: {queryClient}, params}) => queryClient.ensureQueryData(projectQueryOptions(params.id)),
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

function ProjectPage() {
	const {id} = Route.useParams();
	const {data} = useSuspenseQuery(projectQueryOptions(id));

	if (!data) {
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

			<h1 className="text-lg font-semibold">{data.name}</h1>
			{data.projectPath && <p className="mt-0.5 text-xs text-text-500">{data.projectPath}</p>}

			{/* Sessions */}
			<section className="mt-8">
				<h2 className="border-b border-border-300/15 pb-1 text-sm font-semibold">
					Sessions ({data.sessions.length})
				</h2>
				{data.sessions.length === 0 ? (
					<p className="mt-2 text-sm text-text-500">No sessions.</p>
				) : (
					<ul className="mt-2 space-y-1">
						{data.sessions.map((sess) => (
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
			{data.subagentCount > 0 && (
				<section className="mt-8">
					<SubagentTree
						tree={data.subagentTree}
						totalCount={data.subagentCount}
					/>
				</section>
			)}

			{/* Tasks */}
			{data.todos.length > 0 && (
				<section className="mt-8">
					<h2 className="border-b border-border-300/15 pb-1 text-sm font-semibold">
						Tasks ({data.todoCounts.total})
						{data.todoCounts.pending > 0 && (
							<span className="ml-2 text-xs font-normal text-text-500">
								{data.todoCounts.pending} pending
							</span>
						)}
						{data.todoCounts.inProgress > 0 && (
							<span className="ml-2 text-xs font-normal text-blue-500">
								{data.todoCounts.inProgress} in progress
							</span>
						)}
					</h2>
					<div className="mt-2 space-y-1">
						{data.todos.map((task) => (
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
					Memories ({data.memories.length})
				</h2>
				{data.memories.length === 0 ? (
					<p className="mt-2 text-sm text-text-500">No memories.</p>
				) : (
					<ul className="mt-2 space-y-1">
						{data.memories.map((mem) => (
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
			{data.plans.length > 0 && (
				<section className="mt-8">
					<h2 className="border-b border-border-300/15 pb-1 text-sm font-semibold">
						Linked Plans ({data.plans.length})
					</h2>
					<ul className="mt-2 space-y-1">
						{data.plans.map((plan) => (
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
