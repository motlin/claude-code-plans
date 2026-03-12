import {createFileRoute, Link} from '@tanstack/react-router';
import {getProject} from '../lib/server-fns';

export const Route = createFileRoute('/project/$id')({
	component: ProjectPage,
	loader: ({params}) => getProject({data: params.id}),
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

const AGENT_TYPE_COLORS: Record<string, string> = {
	Explore: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
	Plan: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
};

function ProjectPage() {
	const data = Route.useLoaderData();

	if (!data) {
		return (
			<div>
				<Link
					to="/projects"
					className="text-sm text-primary hover:underline"
				>
					&larr; All Projects
				</Link>
				<h1 className="mt-4 text-lg font-semibold">Project Not Found</h1>
				<p className="mt-2 text-muted-foreground">This project could not be found.</p>
			</div>
		);
	}

	return (
		<div>
			<Link
				to="/projects"
				className="text-sm text-primary hover:underline"
			>
				&larr; All Projects
			</Link>

			<h1 className="mt-4 text-lg font-semibold">{data.name}</h1>
			{data.projectPath && <p className="mt-0.5 text-xs text-muted-foreground">{data.projectPath}</p>}

			{/* Sessions */}
			<section className="mt-8">
				<h2 className="border-b border-border pb-1 text-sm font-semibold">Sessions ({data.sessions.length})</h2>
				{data.sessions.length === 0 ? (
					<p className="mt-2 text-sm text-muted-foreground">No sessions.</p>
				) : (
					<ul className="mt-2 space-y-1">
						{data.sessions.map((sess) => (
							<li key={sess.id}>
								<Link
									to="/session/$id"
									params={{id: sess.id}}
									className="block rounded-md p-2 cursor-pointer transition-colors hover:bg-muted/50"
								>
									<div
										className="truncate"
										style={{fontSize: '14px', fontWeight: 430}}
									>
										{sess.title}
									</div>
									<div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
										<span>{formatDate(sess.mtime)}</span>
										{sess.messageCount > 0 && (
											<>
												<span>&middot;</span>
												<span>{sess.messageCount} msgs</span>
											</>
										)}
										{sess.subagents.length > 0 && (
											<>
												<span>&middot;</span>
												<span>
													{sess.subagents.length} subagent
													{sess.subagents.length !== 1 ? 's' : ''}
												</span>
											</>
										)}
										{sess.gitBranch && (
											<>
												<span>&middot;</span>
												<span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
													{sess.gitBranch}
												</span>
											</>
										)}
									</div>
									{sess.summary && sess.summary !== sess.title && (
										<div className="mt-0.5 truncate text-xs text-muted-foreground italic">
											{sess.summary}
										</div>
									)}
								</Link>
								{sess.subagents.length > 0 && (
									<div className="ml-6 mt-0.5 flex flex-wrap gap-1.5 pb-1">
										{sess.subagents.map((agent) => (
											<Link
												key={agent.id}
												to="/session/$id"
												params={{id: agent.id}}
												className="inline-flex items-center gap-1 rounded border border-border/50 px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted/50"
											>
												{agent.agentType && (
													<span
														className={`rounded px-1 py-px text-[9px] font-medium ${AGENT_TYPE_COLORS[agent.agentType] ?? 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}
													>
														{agent.agentType}
													</span>
												)}
												{agent.slug ?? agent.id}
											</Link>
										))}
									</div>
								)}
							</li>
						))}
					</ul>
				)}
			</section>

			{/* Memories */}
			<section className="mt-8">
				<h2 className="border-b border-border pb-1 text-sm font-semibold">Memories ({data.memories.length})</h2>
				{data.memories.length === 0 ? (
					<p className="mt-2 text-sm text-muted-foreground">No memories.</p>
				) : (
					<ul className="mt-2 space-y-1">
						{data.memories.map((mem) => (
							<li key={mem.filename}>
								<Link
									to="/memory/$project/$filename"
									params={{project: mem.project, filename: mem.filename}}
									className="block rounded-md p-2 cursor-pointer transition-colors hover:bg-muted/50"
								>
									<div
										className="truncate"
										style={{fontSize: '14px', fontWeight: 430}}
									>
										{mem.title}
									</div>
									<div className="mt-0.5 text-xs text-muted-foreground">{formatDate(mem.mtime)}</div>
								</Link>
							</li>
						))}
					</ul>
				)}
			</section>

			{/* Linked Plans */}
			{data.plans.length > 0 && (
				<section className="mt-8">
					<h2 className="border-b border-border pb-1 text-sm font-semibold">
						Linked Plans ({data.plans.length})
					</h2>
					<ul className="mt-2 space-y-1">
						{data.plans.map((plan) => (
							<li key={plan.filename}>
								<Link
									to="/plan/$filename"
									params={{filename: plan.filename}}
									className="block rounded-md p-2 cursor-pointer transition-colors hover:bg-muted/50"
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
