import {createFileRoute, Link} from '@tanstack/react-router';
import {getProjects} from '../lib/server-fns';

export const Route = createFileRoute('/projects')({
	component: ProjectsPage,
	loader: () => getProjects(),
	head: () => ({
		meta: [{title: 'Projects'}],
	}),
});

function formatDate(iso: string): string {
	return new Date(iso).toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
	});
}

function ProjectsPage() {
	const projects = Route.useLoaderData();

	return (
		<div>
			<h1 className="text-lg font-semibold">Projects</h1>

			{projects.length === 0 ? (
				<p className="mt-4 text-muted-foreground">No projects found.</p>
			) : (
				<div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{projects.map((project) => (
						<Link
							key={project.id}
							to="/project/$id"
							params={{id: project.id}}
							className="group block rounded-lg border border-border p-4 transition-colors hover:bg-muted/50"
						>
							<div
								className="truncate font-medium"
								style={{fontSize: '14px', fontWeight: 500}}
							>
								{project.name}
							</div>
							{project.projectPath && (
								<div className="mt-0.5 truncate text-xs text-muted-foreground">
									{project.projectPath}
								</div>
							)}
							<div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
								<span>{project.sessionCount} sessions</span>
								<span>&middot;</span>
								<span>{project.memoryCount} memories</span>
								<span>&middot;</span>
								<span>{formatDate(project.lastActivity)}</span>
								{project.gitBranch && (
									<>
										<span>&middot;</span>
										<span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
											{project.gitBranch}
										</span>
									</>
								)}
							</div>
						</Link>
					))}
				</div>
			)}
		</div>
	);
}
