import {useSuspenseQuery} from "@tanstack/react-query";
import {Link} from "@tanstack/react-router";
import {ArrowLeft} from "lucide-react";
import type {ReactNode} from "react";
import {projectDetailQueryOptions, projectsQueryOptions} from "../lib/api/projects";
import {CodePageHeader} from "./code-page-header";
import {useTerminalWritesEnabled} from "../hooks/use-herdr-terminal";
import {OpenTerminalHereButton} from "./new-terminal";
import {DETAIL_TAB_CLASS, DetailTabLabel, DetailTabs} from "./customize/detail-tabs";

export type ProjectSection = "overview" | "sessions" | "tasks" | "memories" | "plans" | "subagents";

type ProjectSubroute =
	| "/project/$id/sessions"
	| "/project/$id/tasks"
	| "/project/$id/memories"
	| "/project/$id/plans"
	| "/project/$id/subagents";

interface CountedTab
{
	section: Exclude<ProjectSection, "overview">;
	to: ProjectSubroute;
	label: string;
	count: number;
}

/** Customize's "← Plugins" back link (upstream detail headers), 24px tall and inset by its own padding. */
const BACK_LINK_CLASS =
	"-ms-2 mb-2 inline-flex h-6 w-fit items-center gap-1.5 rounded-r6 px-2 text-[13px]/[19px] text-primary no-underline hover:bg-fill-ghost-hover";

/** Every project page's content-width column, the max width the Scheduled tasks page uses. */
export function ProjectPage({children}: {children: ReactNode})
{
	return <div className="mx-auto flex w-full max-w-5xl flex-col pb-12">{children}</div>;
}

/**
 * The project pages' shared header: a "← Projects" back link, upstream's serif page title over the project path, and
 * underline tabs linking Overview and each section with its " · N" count, as the Customize plugin and skill details
 * do. An empty section's tab is left out unless it is the page being shown. While Live terminal input is on, the
 * toolbar offers "Open terminal here": a herdr shell in the project's directory.
 */
export function ProjectPageHeader({projectId, section}: {projectId: string; section: ProjectSection})
{
	const {data: detail} = useSuspenseQuery(projectDetailQueryOptions(projectId));
	const {data: projects} = useSuspenseQuery(projectsQueryOptions());
	const writesEnabled = useTerminalWritesEnabled();
	if (!detail) return null;
	const summary = projects.find((project) => project.id === projectId);
	const counted: CountedTab[] = [
		{
			section: "sessions",
			to: "/project/$id/sessions",
			label: "Sessions",
			count: summary?.sessionCount ?? 0,
		},
		{
			section: "tasks",
			to: "/project/$id/tasks",
			label: "Tasks",
			count: summary?.taskCount ?? 0,
		},
		{
			section: "memories",
			to: "/project/$id/memories",
			label: "Memories",
			count: summary?.memoryCount ?? 0,
		},
		{
			section: "plans",
			to: "/project/$id/plans",
			label: "Plans",
			count: summary?.planCount ?? 0,
		},
		{
			section: "subagents",
			to: "/project/$id/subagents",
			label: "Subagents",
			count: detail.subagentCount,
		},
	];
	const params =
	{
		id: detail.id,
	};
	return (
		<>
			<Link to="/projects" className={BACK_LINK_CLASS}>
				<ArrowLeft aria-hidden="true" className="size-4 rtl:-scale-x-100" />
				Projects
			</Link>
			<CodePageHeader
				title={detail.name}
				{...(detail.projectPath
					?
						{
							subtitle: detail.projectPath,
						}
					: {})}
				{...(writesEnabled && detail.projectPath
					?
						{
							toolbar: <OpenTerminalHereButton cwd={detail.projectPath} />,
						}
					: {})}
			>
				<div className="mt-4">
					<DetailTabs label="Project sections">
						<Link
							to="/project/$id"
							params={params}
							activeOptions={
							{
								exact: true,
							}}
							className={DETAIL_TAB_CLASS}
						>
							<DetailTabLabel label="Overview" />
						</Link>
						{counted
							.filter((tab) => tab.count > 0 || tab.section === section)
							.map((tab) => (
								<Link key={tab.section} to={tab.to} params={params} className={DETAIL_TAB_CLASS}>
									<DetailTabLabel label={tab.label} count={tab.count} />
								</Link>
							))}
					</DetailTabs>
				</div>
			</CodePageHeader>
		</>
	);
}
