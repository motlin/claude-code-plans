import {pageTitle} from "../lib/route-title";
import {createFileRoute, useNavigate} from "@tanstack/react-router";
import {useSuspenseQuery} from "@tanstack/react-query";
import {GitBranch, X} from "lucide-react";
import {useMemo} from "react";
import {z} from "zod";
import {projectDetailQueryOptions, projectSessionsQueryOptions, projectsQueryOptions} from "../lib/api/projects";
import {NotFoundContent} from "../components/not-found-content";
import {ProjectPage, ProjectPageHeader} from "../components/project-page-header";
import {SessionRow} from "../components/session-row";
import {useClaudeEvents} from "../hooks/use-claude-events";
import {formatCount} from "../lib/pluralize";

const sessionsSearchSchema = z.object({
	branch: z.string().optional(),
});

export const Route = createFileRoute("/project/$id_/sessions")({
	component: ProjectSessionsPage,
	validateSearch: sessionsSearchSchema,
	loader: async ({context: {queryClient}, params}) => {
		const [detail] = await Promise.all([
			queryClient.query({...projectDetailQueryOptions(params.id), staleTime: "static"}),
			queryClient.query({...projectSessionsQueryOptions(params.id), staleTime: "static"}),
			queryClient.query({...projectsQueryOptions(), staleTime: "static"}),
		]);
		return detail;
	},
	head: ({loaderData}) => ({
		meta: [pageTitle(loaderData ? `${loaderData.name} sessions` : "Project Not Found")],
	}),
});

function ProjectSessionsPage() {
	const {id} = Route.useParams();
	const {data: project} = useSuspenseQuery(projectDetailQueryOptions(id));
	const {data: allSessions} = useSuspenseQuery(projectSessionsQueryOptions(id));
	const {branch} = Route.useSearch();
	const navigate = useNavigate();
	const {activeSessions} = useClaudeEvents();
	const activeIds = new Set(activeSessions.keys());

	const sessions = useMemo(
		() => (branch ? allSessions.filter((s) => s.gitBranch === branch) : allSessions),
		[allSessions, branch],
	);

	const uniqueBranches = useMemo(() => {
		const counts = new Map<string, number>();
		for (const s of allSessions) {
			if (s.gitBranch) {
				counts.set(s.gitBranch, (counts.get(s.gitBranch) ?? 0) + 1);
			}
		}
		return [...counts.entries()].toSorted((a, b) => b[1] - a[1]);
	}, [allSessions]);

	if (!project) {
		return <NotFoundContent />;
	}

	return (
		<ProjectPage>
			<ProjectPageHeader projectId={id} section="sessions" />
			{branch && (
				<p className="text-[13px] text-t6">
					{formatCount(sessions.length, "session")} on {branch}
				</p>
			)}

			{uniqueBranches.length > 1 && (
				<div className="mt-2 flex flex-wrap gap-1.5">
					{branch && (
						<button
							type="button"
							onClick={() => void navigate({to: ".", search: {}, replace: true})}
							className="flex items-center gap-1 rounded-full bg-fill-accent px-2 py-0.5 text-[11px] font-medium text-oncolor-100 transition-colors hover:bg-fill-accent-hover"
						>
							<GitBranch className="h-3 w-3" />
							{branch}
							<X className="h-3 w-3" />
						</button>
					)}
					{!branch &&
						uniqueBranches.slice(0, 12).map(([b, count]) => (
							<button
								key={b}
								type="button"
								onClick={() =>
									void navigate({
										to: ".",
										search: {branch: b},
										replace: true,
									})
								}
								className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-secondary transition-colors hover:bg-surface-0"
							>
								<GitBranch className="h-3 w-3" />
								{b}
								<span className="text-t6">({count})</span>
							</button>
						))}
				</div>
			)}

			{sessions.length === 0 ? (
				<p className="mt-4 text-t6">No sessions for this project.</p>
			) : (
				<ul className="mt-4 space-y-1">
					{sessions.map((sess) => (
						<SessionRow
							key={sess.id}
							session={sess}
							isActive={activeIds.has(sess.id)}
							showProject={false}
						/>
					))}
				</ul>
			)}
		</ProjectPage>
	);
}
