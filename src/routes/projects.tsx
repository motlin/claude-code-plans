import {createFileRoute, Link} from '@tanstack/react-router';
import {useSuspenseQuery} from '@tanstack/react-query';
import {projectsQueryOptions} from '../lib/api/projects';

export const Route = createFileRoute('/projects')({
	component: ProjectsPage,
	loader: ({context: {queryClient}}) => queryClient.ensureQueryData(projectsQueryOptions()),
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
	const {data: projects} = useSuspenseQuery(projectsQueryOptions());

	return (
		<div>
			<h1 className="text-lg font-semibold">Projects</h1>

			{projects.length === 0 ? (
				<p className="mt-4 text-text-500">No projects found.</p>
			) : (
				<div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{projects.map((project) => (
						<Link
							key={project.id}
							to="/project/$id"
							params={{id: project.id}}
							className="group block rounded-lg border border-border-300/15 p-4 transition-colors hover:bg-bg-200/50"
						>
							<div
								className="truncate font-medium"
								style={{fontSize: '14px', fontWeight: 500}}
							>
								{project.projectPath ? project.projectPath.split('/').pop() : project.name}
							</div>
							{project.projectPath && (
								<div className="mt-0.5 truncate text-xs text-text-500">{project.projectPath}</div>
							)}
							<div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-text-500">
								{project.activeCount > 0 && (
									<>
										<span className="flex items-center gap-1 text-green-500">
											<span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
											{project.activeCount} active
										</span>
										<span>&middot;</span>
									</>
								)}
								<span>{project.sessionCount} sessions</span>
								{project.planCount > 0 && (
									<>
										<span>&middot;</span>
										<span>{project.planCount} plans</span>
									</>
								)}
								{project.memoryCount > 0 && (
									<>
										<span>&middot;</span>
										<span>{project.memoryCount} memories</span>
									</>
								)}
								{project.taskCount > 0 && (
									<>
										<span>&middot;</span>
										<span>{project.taskCount} tasks</span>
									</>
								)}
								<span>&middot;</span>
								<span>{formatDate(project.lastActivity)}</span>
							</div>
						</Link>
					))}
				</div>
			)}
		</div>
	);
}
