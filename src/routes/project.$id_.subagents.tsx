import {createFileRoute, Link} from '@tanstack/react-router';
import {ArrowLeft} from 'lucide-react';
import {getProjectSubagents} from '../lib/server-fns';
import {DetailTopBar, pillStyles} from '../components/detail-top-bar';
import {SubagentGantt} from '../components/subagent-gantt';

export const Route = createFileRoute('/project/$id_/subagents')({
	component: ProjectSubagentsPage,
	loader: ({params}) => getProjectSubagents({data: params.id}),
	head: ({loaderData}) => ({
		meta: [{title: loaderData ? `${loaderData.project.name} subagents` : 'Project Not Found'}],
	}),
});

function ProjectSubagentsPage() {
	const data = Route.useLoaderData();

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

	const {project, agents, subagentCount} = data;

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
