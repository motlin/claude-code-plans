import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { projectMemoriesQueryOptions } from "../lib/api/memories";
import { DetailTopBar, pillStyles } from "../components/detail-top-bar";
import { DebugLink } from "../components/debug-link";

export const Route = createFileRoute("/project/$id_/memories")({
  component: ProjectMemoriesPage,
  loader: ({ context: { queryClient }, params }) =>
    queryClient.ensureQueryData(projectMemoriesQueryOptions(params.id)),
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData ? `${loaderData.project.name} memories` : "Project Not Found",
      },
    ],
  }),
});

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ProjectMemoriesPage() {
  const { id } = Route.useParams();
  const { data } = useSuspenseQuery(projectMemoriesQueryOptions(id));

  if (!data) {
    return (
      <div>
        <DetailTopBar>
          <Link to="/projects" className={pillStyles.primary}>
            <ArrowLeft className="h-3.5 w-3.5" />
            All Projects
          </Link>
        </DetailTopBar>
        <h1 className="mt-4 text-lg font-semibold">Project Not Found</h1>
      </div>
    );
  }

  const { project, memories } = data;

  return (
    <div>
      <DetailTopBar>
        <Link to="/project/$id" params={{ id: project.id }} className={pillStyles.primary}>
          <ArrowLeft className="h-3.5 w-3.5" />
          {project.name}
        </Link>
      </DetailTopBar>

      <h1 className="text-lg font-semibold">{project.name} memories</h1>
      <p className="mt-0.5 text-xs text-text-500">
        {memories.length} {memories.length === 1 ? "memory" : "memories"}
      </p>

      {memories.length === 0 ? (
        <p className="mt-4 text-text-500">No memories for this project.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {memories.map((mem) => (
            <li key={mem.filename} className="relative">
              <Link
                to="/memory/$project/$filename"
                params={{ project: mem.project, filename: mem.filename }}
                className="flex items-center justify-between rounded-md border border-border-300/15 px-4 py-3 transition-colors hover:bg-bg-200/50"
              >
                <span className="text-sm font-medium">{mem.title}</span>
                <span className="ml-4 shrink-0 text-xs text-text-500">{formatDate(mem.mtime)}</span>
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
    </div>
  );
}
