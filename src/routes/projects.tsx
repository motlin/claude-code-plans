import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { projectsQueryOptions } from "../lib/api/projects";
import { ListPageHeader } from "../components/list-page-header";
import { formatCount } from "../lib/pluralize";

export const Route = createFileRoute("/projects")({
  component: ProjectsPage,
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(projectsQueryOptions()),
  head: () => ({
    meta: [{ title: "Projects" }],
  }),
});

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface ProjectCounts {
  activeCount: number;
  sessionCount: number;
  planCount: number;
  memoryCount: number;
  taskCount: number;
  lastActivity: string;
}

export function ProjectCardCounts({ project }: { project: ProjectCounts }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-t6">
      {project.activeCount > 0 && (
        <>
          <span className="flex items-center gap-1 text-green-500">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
            {project.activeCount} active
          </span>
          <span>&middot;</span>
        </>
      )}
      <span>{formatCount(project.sessionCount, "session")}</span>
      {project.planCount > 0 && (
        <>
          <span>&middot;</span>
          <span>{formatCount(project.planCount, "plan")}</span>
        </>
      )}
      {project.memoryCount > 0 && (
        <>
          <span>&middot;</span>
          <span>{formatCount(project.memoryCount, "memory")}</span>
        </>
      )}
      {project.taskCount > 0 && (
        <>
          <span>&middot;</span>
          <span>{formatCount(project.taskCount, "task")}</span>
        </>
      )}
      <span>&middot;</span>
      <span>{formatDate(project.lastActivity)}</span>
    </div>
  );
}

function ProjectsPage() {
  const { data: projects } = useSuspenseQuery(projectsQueryOptions());

  return (
    <div>
      <ListPageHeader title="Projects" count={projects.length} itemLabel="project" />

      {projects.length === 0 ? (
        <p className="mt-4 text-t6">No projects found.</p>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Link
              key={project.id}
              to="/project/$id"
              params={{ id: project.id }}
              className="group block rounded-lg border border-border p-4 transition-colors hover:bg-surface-0/50"
            >
              <div className="truncate font-medium" style={{ fontSize: "14px", fontWeight: 500 }}>
                {project.projectPath ? project.projectPath.split("/").pop() : project.name}
              </div>
              {project.projectPath && (
                <div className="mt-0.5 truncate text-xs text-t6">{project.projectPath}</div>
              )}
              <ProjectCardCounts project={project} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
