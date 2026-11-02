import {pageTitle} from "../lib/route-title";
import {createFileRoute, Link} from "@tanstack/react-router";
import {useSuspenseQuery} from "@tanstack/react-query";
import {projectMemoriesQueryOptions} from "../lib/api/memories";
import {projectDetailQueryOptions, projectsQueryOptions} from "../lib/api/projects";
import {toMdSlug} from "../lib/md-slug";
import {NotFoundContent} from "../components/not-found-content";
import {ProjectPage, ProjectPageHeader} from "../components/project-page-header";
import {DebugLink} from "../components/debug-link";
import {ListItemDate} from "../components/list-item-date";

export const Route = createFileRoute("/project/$id_/memories")(
	{
		component: ProjectMemoriesPage,
		loader: async ({context: {queryClient}, params}) =>
		{
			const [memories] = await Promise.all([
				queryClient.query(
					{
						...projectMemoriesQueryOptions(params.id),
						staleTime: "static",
					},
				),
				queryClient.query(
					{
						...projectDetailQueryOptions(params.id),
						staleTime: "static",
					},
				),
				queryClient.query(
					{
						...projectsQueryOptions(),
						staleTime: "static",
					},
				),
			]);
			return memories;
		},
		head: ({loaderData}) => (
		{
			meta: [pageTitle(loaderData ? `${loaderData.project.name} memories` : "Project Not Found")],
		}),
	},
);

function ProjectMemoriesPage()
{
	const {id} = Route.useParams();
	const {data} = useSuspenseQuery(projectMemoriesQueryOptions(id));

	if (!data)
	{
		return <NotFoundContent />;
	}

	const {memories} = data;

	return (
		<ProjectPage>
			<ProjectPageHeader projectId={id} section="memories" />

			{memories.length === 0 ? (
				<p className="mt-4 text-t6">No memories for this project.</p>
			) : (
				<ul className="mt-4 space-y-2">
					{memories.map((mem) => (
						<li key={mem.filename} className="relative">
							<Link
								to="/memory/$project/$filename"
								params={
								{
									project: mem.project,
									filename: toMdSlug(mem.filename),
								}}
								className="flex items-center justify-between rounded-md border border-border px-4 py-3 transition-colors hover:bg-surface-0"
							>
								<span className="text-sm font-medium">{mem.title}</span>
								<ListItemDate iso={mem.mtime} />
							</Link>
							<DebugLink
								kind="memory"
								relativePath={`${mem.project}/memory/${mem.filename}`}
								className="absolute right-1 top-1"
							/>
						</li>
					))}
				</ul>
			)}
		</ProjectPage>
	);
}
