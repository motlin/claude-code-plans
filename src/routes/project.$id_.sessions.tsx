import {createFileRoute, Link} from '@tanstack/react-router';
import {ArrowLeft} from 'lucide-react';
import {getProjectSessionsList} from '../lib/server-fns';
import {DetailTopBar, pillStyles} from '../components/detail-top-bar';
import {useClaudeEvents} from '../hooks/use-claude-events';

export const Route = createFileRoute('/project/$id_/sessions')({
	component: ProjectSessionsPage,
	loader: ({params}) => getProjectSessionsList({data: params.id}),
	head: ({loaderData}) => ({
		meta: [{title: loaderData ? `${loaderData.project.name} sessions` : 'Project Not Found'}],
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

function ProjectSessionsPage() {
	const data = Route.useLoaderData();
	const {activeSessions} = useClaudeEvents();
	const activeIds = new Set(activeSessions.keys());

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
			</div>
		);
	}

	const {project, sessions} = data;

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

			<h1 className="text-lg font-semibold">{project.name} sessions</h1>
			<p className="mt-0.5 text-xs text-text-500">
				{sessions.length} {sessions.length === 1 ? 'session' : 'sessions'}
			</p>

			{sessions.length === 0 ? (
				<p className="mt-4 text-text-500">No sessions for this project.</p>
			) : (
				<ul className="mt-4 space-y-1">
					{sessions.map((sess) => {
						const isActive = activeIds.has(sess.id);
						return (
							<li key={sess.id}>
								<Link
									to="/session/$id"
									params={{id: sess.id}}
									className="block rounded-md p-2 cursor-pointer transition-colors hover:bg-bg-200/50"
								>
									<div
										className="flex items-center gap-1.5 truncate"
										style={{fontSize: '14px', fontWeight: 430}}
									>
										{isActive && (
											<span
												className="inline-block h-2 w-2 shrink-0 rounded-full bg-success-000"
												title="Active"
											/>
										)}
										<span className="truncate">{sess.title}</span>
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
						);
					})}
				</ul>
			)}
		</div>
	);
}
