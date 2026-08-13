import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, GitBranch } from "lucide-react";
import { useEffect, useMemo } from "react";
import {
  projectsQueryOptions,
  projectSessionsQueryOptions,
  projectPlansQueryOptions,
  projectTasksQueryOptions,
  projectBranchesQueryOptions,
} from "../../../lib/api/projects";
import { projectMemoriesQueryOptions } from "../../../lib/api/memories";
import { toMdSlug } from "../../../lib/md-slug";
import type { SidebarProjectDetail } from "../types";
import { LoadingBars } from "../primitives/LoadingBars";

function prefetchProjectDetail(queryClient: ReturnType<typeof useQueryClient>, projectId: string) {
  void queryClient.prefetchQuery(projectSessionsQueryOptions(projectId));
  void queryClient.prefetchQuery(projectPlansQueryOptions(projectId));
  void queryClient.prefetchQuery(projectTasksQueryOptions(projectId));
  void queryClient.prefetchQuery(projectMemoriesQueryOptions(projectId));
}

/**
 * `expandedProjects` lives in `Sidebar` because opening an item in another
 * section collapses — and unmounts — this sublist; local state would come back
 * collapse-all'd. The project being viewed expands itself through
 * `onExpandProject`, which leaves it collapsible again afterwards.
 */
export function ProjectsSubList({
  activeItemId,
  expandedProjects,
  onToggleProject,
  onExpandProject,
}: {
  activeItemId: string | null;
  expandedProjects: ReadonlySet<string>;
  onToggleProject: (projectId: string) => void;
  onExpandProject: (projectId: string) => void;
}) {
  const { data: projects } = useQuery(projectsQueryOptions());
  const queryClient = useQueryClient();

  // Auto-expand the active project and prefetch its sub-resources into the
  // shared TanStack Query cache so sidebar + /project/$id share data.
  useEffect(() => {
    if (!projects || !activeItemId) return;

    const activeProject = projects.find((p) => p.id === activeItemId);
    if (!activeProject) return;

    onExpandProject(activeProject.id);
    prefetchProjectDetail(queryClient, activeProject.id);
  }, [activeItemId, projects, queryClient, onExpandProject]);

  function toggleProject(projectId: string) {
    onToggleProject(projectId);
    if (!expandedProjects.has(projectId)) {
      prefetchProjectDetail(queryClient, projectId);
    }
  }

  if (projects === undefined) {
    return (
      <div className="pl-10">
        <LoadingBars />
      </div>
    );
  }

  if (projects.length === 0) {
    return null;
  }

  const linkClass = (isActive: boolean) =>
    `mb-px block truncate rounded-[4px] px-2 py-1 text-xs no-underline transition-colors ${
      isActive
        ? "bg-bg-300/50 font-medium text-text-000"
        : "text-text-500 hover:bg-bg-300/50 hover:text-text-200"
    }`;

  const labelClass =
    "mb-px flex w-full items-center gap-1 rounded-[4px] px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-text-400";

  return (
    <div className="pl-10">
      {projects.map((project) => {
        const isActive = project.id === activeItemId;
        const isExpanded = expandedProjects.has(project.id);

        return (
          <div key={project.id}>
            <div className="flex items-center">
              <button
                type="button"
                onClick={() => toggleProject(project.id)}
                className="flex h-5 w-4 shrink-0 items-center justify-center text-text-500 transition-colors hover:text-text-200"
                title={`${isExpanded ? "Collapse" : "Expand"} ${project.name}`}
              >
                <ChevronRight
                  className="h-2.5 w-2.5 transition-transform duration-200"
                  style={{
                    transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                  }}
                />
              </button>
              <Link
                to="/project/$id"
                params={{ id: project.id }}
                className={linkClass(isActive)}
                style={{ flex: 1, minWidth: 0 }}
              >
                {project.name}
              </Link>
            </div>
            {isExpanded && (
              <ExpandedProjectDetail
                projectId={project.id}
                labelClass={labelClass}
                linkClass={linkClass}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// Per-project expanded detail reads from shared sub-resource query caches so
// sidebar + /project/$id route share fetches per project.
function ExpandedProjectDetail({
  projectId,
  labelClass,
  linkClass,
}: {
  projectId: string;
  labelClass: string;
  linkClass: (isActive: boolean) => string;
}) {
  const { data: sessions, isFetching: isFetchingSessions } = useQuery(
    projectSessionsQueryOptions(projectId),
  );
  const { data: plans } = useQuery(projectPlansQueryOptions(projectId));
  const { data: tasksData } = useQuery(projectTasksQueryOptions(projectId));
  const { data: memoriesData } = useQuery(projectMemoriesQueryOptions(projectId));
  const { data: branches } = useQuery(projectBranchesQueryOptions(projectId));

  const detail: SidebarProjectDetail | undefined = useMemo(() => {
    if (!sessions || !plans || !tasksData || !memoriesData) return undefined;
    return {
      sessions: sessions.map((s) => {
        const item: {
          id: string;
          title: string;
          gitBranch?: string | undefined;
        } = {
          id: s.id,
          title: s.title,
        };
        if (s.gitBranch !== undefined) item.gitBranch = s.gitBranch;
        return item;
      }),
      plans: plans.map((p) => ({ filename: p.filename, title: p.title })),
      memories: (memoriesData?.memories ?? []).map((m) => ({
        filename: m.filename,
        title: m.title,
        project: m.project,
      })),
      todoCounts: tasksData.todoCounts,
    };
  }, [sessions, plans, tasksData, memoriesData]);

  return (
    <div className="pl-4">
      {!detail && isFetchingSessions && <LoadingBars />}
      {detail && (
        <>
          {branches && branches.length > 1 && (
            <div>
              <div className={labelClass}>
                <GitBranch className="h-2.5 w-2.5" />
                Branches
              </div>
              {branches.slice(0, 8).map((b) => (
                <Link
                  key={b.branch}
                  to="/project/$id/sessions"
                  params={{ id: projectId }}
                  search={{ branch: b.branch }}
                  className={linkClass(false)}
                  style={{ paddingLeft: "1.5rem" }}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="truncate">{b.branch}</span>
                    <span className="shrink-0 text-[10px] text-text-400">({b.sessionCount})</span>
                  </span>
                </Link>
              ))}
              {branches.length > 8 && (
                <Link
                  to="/project/$id"
                  params={{ id: projectId }}
                  className="mb-px block truncate rounded-[4px] py-1 text-[10px] italic text-text-400 no-underline hover:text-text-500"
                  style={{ paddingLeft: "1.5rem", paddingRight: "0.5rem" }}
                >
                  +{branches.length - 8} more...
                </Link>
              )}
            </div>
          )}
          {detail.sessions.length > 0 && (
            <div>
              <div className={labelClass}>Sessions</div>
              {detail.sessions.slice(0, 10).map((sess) => (
                <Link
                  key={sess.id}
                  to="/session/$id"
                  params={{ id: sess.id }}
                  className={linkClass(false)}
                  style={{ paddingLeft: "1.5rem" }}
                >
                  {sess.title}
                </Link>
              ))}
              {detail.sessions.length > 10 && (
                <Link
                  to="/project/$id"
                  params={{ id: projectId }}
                  className="mb-px block truncate rounded-[4px] py-1 text-[10px] italic text-text-400 no-underline hover:text-text-500"
                  style={{ paddingLeft: "1.5rem", paddingRight: "0.5rem" }}
                >
                  +{detail.sessions.length - 10} more...
                </Link>
              )}
            </div>
          )}
          {detail.plans.length > 0 && (
            <div>
              <div className={labelClass}>Plans</div>
              {detail.plans.map((plan) => (
                <Link
                  key={plan.filename}
                  to="/plan/$filename"
                  params={{ filename: toMdSlug(plan.filename) }}
                  className={linkClass(false)}
                  style={{ paddingLeft: "1.5rem" }}
                >
                  {plan.title}
                </Link>
              ))}
            </div>
          )}
          {detail.memories.length > 0 && (
            <div>
              <div className={labelClass}>Memories</div>
              {detail.memories.map((mem) => (
                <Link
                  key={mem.filename}
                  to="/memory/$project/$filename"
                  params={{ project: mem.project, filename: toMdSlug(mem.filename) }}
                  className={linkClass(false)}
                  style={{ paddingLeft: "1.5rem" }}
                >
                  {mem.title}
                </Link>
              ))}
            </div>
          )}
          {(detail.todoCounts.pending > 0 || detail.todoCounts.inProgress > 0) && (
            <div>
              <div className={labelClass}>Tasks</div>
              <Link
                to="/project/$id"
                params={{ id: projectId }}
                className={linkClass(false)}
                style={{ paddingLeft: "1.5rem" }}
              >
                {detail.todoCounts.pending > 0 && `${detail.todoCounts.pending} pending`}
                {detail.todoCounts.pending > 0 && detail.todoCounts.inProgress > 0 && ", "}
                {detail.todoCounts.inProgress > 0 && `${detail.todoCounts.inProgress} in progress`}
              </Link>
            </div>
          )}
          {detail.sessions.length === 0 &&
            detail.plans.length === 0 &&
            detail.memories.length === 0 &&
            detail.todoCounts.total === 0 && (
              <div className="px-2 py-1 text-[10px] italic text-text-400">No items</div>
            )}
        </>
      )}
    </div>
  );
}
