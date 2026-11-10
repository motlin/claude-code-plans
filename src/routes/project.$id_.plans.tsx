import {pageTitle} from "../lib/route-title";
import {createFileRoute, Link} from "@tanstack/react-router";
import {useSuspenseQuery} from "@tanstack/react-query";
import {projectDetailQueryOptions, projectsQueryOptions, projectPlansQueryOptions} from "../lib/api/projects";
import {toMdSlug} from "../lib/md-slug";
import {NotFoundContent} from "../components/not-found-content";
import {ProjectPage, ProjectPageHeader} from "../components/project-page-header";
import {DebugLink} from "../components/debug-link";
import {ListItemDate} from "../components/list-item-date";

export const Route = createFileRoute("/project/$id_/plans")({
	component: ProjectPlansPage,
	loader: async ({context: {queryClient}, params}) => {
		const [detail] = await Promise.all([
			queryClient.query({...projectDetailQueryOptions(params.id), staleTime: "static"}),
			queryClient.query({...projectsQueryOptions(), staleTime: "static"}),
			queryClient.query({...projectPlansQueryOptions(params.id), staleTime: "static"}),
		]);
		return detail;
	},
	head: ({loaderData}) => ({
		meta: [pageTitle(loaderData ? `${loaderData.name} plans` : "Project Not Found")],
	}),
});

function ProjectPlansPage() {
	const {id} = Route.useParams();
	const {data: project} = useSuspenseQuery(projectDetailQueryOptions(id));
	const {data: plans} = useSuspenseQuery(projectPlansQueryOptions(id));

	if (!project) {
		return <NotFoundContent />;
	}

	const count = plans.length;

	return (
		<ProjectPage>
			<ProjectPageHeader projectId={id} section="plans" />

			{count === 0 ? (
				<p className="mt-4 text-t6">No plans linked to this project.</p>
			) : (
				<ul className="mt-4 space-y-2">
					{plans.map((plan) => (
						<li key={plan.filename} className="relative">
							<Link
								to="/plan/$filename"
								params={{filename: toMdSlug(plan.filename)}}
								className="flex items-center justify-between rounded-md border border-border px-4 py-3 transition-colors hover:bg-surface-0"
							>
								<span className="text-sm font-medium">{plan.title}</span>
								{plan.mtime && <ListItemDate iso={plan.mtime} />}
							</Link>
							<DebugLink kind="plan" relativePath={plan.filename} className="absolute right-1 top-1" />
						</li>
					))}
				</ul>
			)}
		</ProjectPage>
	);
}
