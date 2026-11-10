import {pageTitle} from "../lib/route-title";
import {createFileRoute, Link} from "@tanstack/react-router";
import {useSuspenseQuery} from "@tanstack/react-query";
import {Circle} from "lucide-react";
import type {ReactNode} from "react";
import {
	projectDetailQueryOptions,
	projectSessionsQueryOptions,
	projectPlansQueryOptions,
	projectTasksQueryOptions,
	projectsQueryOptions,
} from "../lib/api/projects";
import {projectMemoriesQueryOptions} from "../lib/api/memories";
import {projectApprovalsQueryOptions} from "../lib/api/approvals";
import {toMdSlug} from "../lib/md-slug";
import {formatRelativeTimeFromIso} from "../lib/relative-time";
import {useClaudeEvents} from "../hooks/use-claude-events";
import {ListItemDate} from "../components/list-item-date";
import {NotFoundContent} from "../components/not-found-content";
import {pillStyles} from "../components/pill-styles";
import {MarkdownInline} from "../components/markdown-view";
import {ProjectPage, ProjectPageHeader} from "../components/project-page-header";
import {SessionRow} from "../components/session-row";
import {TaskOwner} from "../components/task-owner";

export const Route = createFileRoute("/project/$id")({
	component: ProjectOverviewPage,
	loader: async ({context: {queryClient}, params}) => {
		const [detail] = await Promise.all([
			queryClient.query({...projectDetailQueryOptions(params.id), staleTime: "static"}),
			queryClient.query({...projectsQueryOptions(), staleTime: "static"}),
			queryClient.query({...projectSessionsQueryOptions(params.id), staleTime: "static"}),
			queryClient.query({...projectPlansQueryOptions(params.id), staleTime: "static"}),
			queryClient.query({...projectTasksQueryOptions(params.id), staleTime: "static"}),
			queryClient.query({...projectMemoriesQueryOptions(params.id), staleTime: "static"}),
			queryClient.query({...projectApprovalsQueryOptions(params.id), staleTime: "static"}),
		]);
		return detail;
	},
	head: ({loaderData}) => ({
		meta: [pageTitle(loaderData?.name ?? "Project Not Found")],
	}),
});

/** How many of each section's newest items the overview previews before its "View all" link. */
const SESSION_PREVIEW = 10;
const ITEM_PREVIEW = 5;

const ROW_CLASS =
	"flex items-center justify-between rounded-md border border-border px-4 py-3 no-underline transition-colors hover:bg-surface-0";

/** One overview section: the list pages' group heading, its rows, and a link to the full section when it holds more. */
function OverviewSection({
	title,
	more,
	children,
}: {
	title: string;
	more?: {
		to: "/project/$id/sessions" | "/project/$id/tasks" | "/project/$id/memories" | "/project/$id/plans";
		id: string;
		count: number;
	};
	children: ReactNode;
}) {
	return (
		<section className="mt-6 first:mt-2">
			<h2 className="border-b border-border pb-1 text-sm font-semibold">{title}</h2>
			{children}
			{more && more.count > 0 && (
				<Link
					to={more.to}
					params={{id: more.id}}
					className="mt-1 block px-2 text-xs text-accent-100 hover:underline"
				>
					View all {more.count} &rarr;
				</Link>
			)}
		</section>
	);
}

function ProjectOverviewPage() {
	const {id} = Route.useParams();
	const {data: detail} = useSuspenseQuery(projectDetailQueryOptions(id));
	const {data: sessions} = useSuspenseQuery(projectSessionsQueryOptions(id));
	const {data: plans} = useSuspenseQuery(projectPlansQueryOptions(id));
	const {data: tasksData} = useSuspenseQuery(projectTasksQueryOptions(id));
	const {data: memoriesData} = useSuspenseQuery(projectMemoriesQueryOptions(id));
	const {data: approvalsData} = useSuspenseQuery(projectApprovalsQueryOptions(id));
	const {activeSessions} = useClaudeEvents();

	if (!detail) {
		return <NotFoundContent />;
	}

	const memories = memoriesData?.memories ?? [];
	const openTasks = tasksData.todos.filter((task) => task.status !== "completed");
	const uniquePlans = [...new Map(plans.map((plan) => [plan.filename, plan])).values()];
	const approvals = approvalsData.approvals;
	const isEmpty =
		approvals.length === 0 &&
		sessions.length === 0 &&
		openTasks.length === 0 &&
		memories.length === 0 &&
		uniquePlans.length === 0;

	return (
		<ProjectPage>
			<ProjectPageHeader projectId={id} section="overview" />

			{isEmpty && <p className="mt-2 text-t6">Nothing in this project yet.</p>}

			{approvals.length > 0 && (
				<OverviewSection title={`Awaiting approval · ${approvals.length}`}>
					<ul className="mt-2 space-y-2">
						{approvals.map((approval) => {
							const linkProps = approval.planFilename
								? ({
										to: "/plan/$filename",
										params: {filename: toMdSlug(approval.planFilename)},
									} as const)
								: ({
										to: "/session/$id",
										params: {id: approval.sessionId},
									} as const);
							return (
								<li key={`${approval.sessionId}:${approval.toolUseId}`}>
									<Link {...linkProps} className={ROW_CLASS}>
										<span className={pillStyles.outline}>{approval.toolName}</span>
										<span className="ml-4 shrink-0 text-xs text-t6">
											{formatRelativeTimeFromIso(approval.blockedSince)}
										</span>
									</Link>
								</li>
							);
						})}
					</ul>
				</OverviewSection>
			)}

			{sessions.length > 0 && (
				<OverviewSection
					title="Recent sessions"
					more={{
						to: "/project/$id/sessions",
						id,
						count: sessions.length > SESSION_PREVIEW ? sessions.length : 0,
					}}
				>
					<ul className="mt-1 space-y-1">
						{sessions.slice(0, SESSION_PREVIEW).map((session) => (
							<SessionRow
								key={session.id}
								session={session}
								isActive={activeSessions.has(session.id)}
								showProject={false}
							/>
						))}
					</ul>
				</OverviewSection>
			)}

			{openTasks.length > 0 && (
				<OverviewSection
					title="Open tasks"
					more={{
						to: "/project/$id/tasks",
						id,
						count: openTasks.length > ITEM_PREVIEW ? tasksData.todos.length : 0,
					}}
				>
					<ul className="mt-1 space-y-1">
						{openTasks.slice(0, ITEM_PREVIEW).map((task) => (
							<li key={task.taskId} className="flex items-start gap-2 rounded-md p-2">
								<Circle
									className={`mt-0.5 h-4 w-4 shrink-0 ${task.status === "in_progress" ? "text-blue-500" : "text-t6"}`}
								/>
								<div className="min-w-0 flex-1">
									<div className="text-sm text-primary">
										#{task.taskId} <MarkdownInline markdown={task.subject} />
									</div>
									<TaskOwner owner={task.owner} />
									{task.blockedBy.length > 0 && (
										<div className="mt-0.5 text-[10px] text-orange-500">
											blocked by #{task.blockedBy.join(", #")}
										</div>
									)}
								</div>
							</li>
						))}
					</ul>
				</OverviewSection>
			)}

			{memories.length > 0 && (
				<OverviewSection
					title="Memories"
					more={{
						to: "/project/$id/memories",
						id,
						count: memories.length > ITEM_PREVIEW ? memories.length : 0,
					}}
				>
					<ul className="mt-2 space-y-2">
						{memories.slice(0, ITEM_PREVIEW).map((mem) => (
							<li key={mem.filename}>
								<Link
									to="/memory/$project/$filename"
									params={{project: mem.project, filename: toMdSlug(mem.filename)}}
									className={ROW_CLASS}
								>
									<span className="truncate text-sm font-medium">{mem.title}</span>
									<ListItemDate iso={mem.mtime} />
								</Link>
							</li>
						))}
					</ul>
				</OverviewSection>
			)}

			{uniquePlans.length > 0 && (
				<OverviewSection
					title="Plans"
					more={{
						to: "/project/$id/plans",
						id,
						count: uniquePlans.length > ITEM_PREVIEW ? uniquePlans.length : 0,
					}}
				>
					<ul className="mt-2 space-y-2">
						{uniquePlans.slice(0, ITEM_PREVIEW).map((plan) => (
							<li key={plan.filename}>
								<Link
									to="/plan/$filename"
									params={{filename: toMdSlug(plan.filename)}}
									className={ROW_CLASS}
								>
									<span className="truncate text-sm font-medium">{plan.title}</span>
									{plan.mtime && <ListItemDate iso={plan.mtime} />}
								</Link>
							</li>
						))}
					</ul>
				</OverviewSection>
			)}
		</ProjectPage>
	);
}
