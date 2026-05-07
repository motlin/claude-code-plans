import {createFileRoute, Link} from '@tanstack/react-router';
import {useSuspenseQuery} from '@tanstack/react-query';
import {ArrowLeft} from 'lucide-react';
import {projectDetailQueryOptions, projectSubagentsQueryOptions} from '../lib/api/projects';
import {DetailTopBar, pillStyles} from '../components/detail-top-bar';
import {SubagentGantt} from '../components/subagent-gantt';

export const Route = createFileRoute('/project/$id_/subagents')({
	component: ProjectSubagentsPage,
	loader: async ({context: {queryClient}, params}) => {
		const [detail] = await Promise.all([
			queryClient.ensureQueryData(projectDetailQueryOptions(params.id)),
			queryClient.ensureQueryData(projectSubagentsQueryOptions(params.id)),
		]);
		return detail;
	},
	head: ({loaderData}) => ({
		meta: [{title: loaderData ? `${loaderData.name} subagents` : 'Project Not Found'}],
	}),
});

function ProjectSubagentsPage() {
	const {id} = Route.useParams();
	const {data: project} = useSuspenseQuery(projectDetailQueryOptions(id));
	const {data: agents} = useSuspenseQuery(projectSubagentsQueryOptions(id));

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

	const subagentCount = agents.length;

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

			<h1 className="text-lg font-semibold">{project.name} subagents</h1>
			<p className="mt-0.5 text-xs text-text-500">
				{subagentCount} {subagentCount === 1 ? 'subagent' : 'subagents'}
			</p>

			{subagentCount === 0 ? (
				<p className="mt-4 text-text-500">No subagents for this project.</p>
			) : (
				<section className="mt-4">
					<SubagentGantt agents={agents} />
				</section>
			)}
		</div>
	);
}
