import {pageTitle} from "../lib/route-title";
import {createFileRoute} from "@tanstack/react-router";
import {useSuspenseQuery} from "@tanstack/react-query";
import {projectDetailQueryOptions, projectsQueryOptions, projectSubagentsQueryOptions} from "../lib/api/projects";
import {NotFoundContent} from "../components/not-found-content";
import {ProjectPage, ProjectPageHeader} from "../components/project-page-header";
import {SubagentGantt} from "../components/subagent-gantt";
import {SubagentSequence} from "../components/subagent-sequence";
import {SubagentTree} from "../components/subagent-tree";
import {useSettings} from "../components/settings-context";

export const Route = createFileRoute("/project/$id_/subagents")({
	component: ProjectSubagentsPage,
	loader: async ({context: {queryClient}, params}) => {
		const [detail] = await Promise.all([
			queryClient.query({...projectDetailQueryOptions(params.id), staleTime: "static"}),
			queryClient.query({...projectsQueryOptions(), staleTime: "static"}),
			queryClient.query({...projectSubagentsQueryOptions(params.id), staleTime: "static"}),
		]);
		return detail;
	},
	head: ({loaderData}) => ({
		meta: [pageTitle(loaderData ? `${loaderData.name} subagents` : "Project Not Found")],
	}),
});

function ProjectSubagentsPage() {
	const {id} = Route.useParams();
	const {data: project} = useSuspenseQuery(projectDetailQueryOptions(id));
	const {data: agents} = useSuspenseQuery(projectSubagentsQueryOptions(id));
	const {settings} = useSettings();
	const subagentView = settings.defaultSubagentView;

	if (!project) {
		return <NotFoundContent />;
	}

	const subagentCount = agents.length;

	return (
		<ProjectPage>
			<ProjectPageHeader projectId={id} section="subagents" />

			{subagentCount === 0 ? (
				<p className="mt-4 text-t6">No subagents for this project.</p>
			) : (
				<section className="mt-4">
					{subagentView === "tree" ? (
						<SubagentTree agents={agents} />
					) : subagentView === "sequence" ? (
						<SubagentSequence agents={agents} />
					) : (
						<SubagentGantt agents={agents} />
					)}
				</section>
			)}
		</ProjectPage>
	);
}
