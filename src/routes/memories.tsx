import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueries, useSuspenseQuery } from "@tanstack/react-query";
import { projectsQueryOptions } from "../lib/api/projects";
import { projectMemoriesQueryOptions, type MemoryListItem } from "../lib/api/memories";
import { DebugLink } from "../components/debug-link";

export const Route = createFileRoute("/memories")({
  component: MemoriesPage,
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(projectsQueryOptions()),
  head: () => ({
    meta: [{ title: "Claude Memories" }],
  }),
});

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

interface MemoryGroup {
  project: string;
  projectName: string;
  memories: MemoryListItem[];
}

function MemoriesPage() {
  const { data: projects } = useSuspenseQuery(projectsQueryOptions());
  const memoryQueries = useQueries({
    queries: projects.map((p) => projectMemoriesQueryOptions(p.id)),
  });

  const groups: MemoryGroup[] = [];
  for (let i = 0; i < projects.length; i++) {
    const data = memoryQueries[i]?.data;
    if (data && data.memories.length > 0) {
      groups.push({
        project: data.project.id,
        projectName: data.project.name,
        memories: data.memories,
      });
    }
  }
  groups.sort((a, b) => {
    const aMax = Math.max(...a.memories.map((m) => new Date(m.mtime).getTime()));
    const bMax = Math.max(...b.memories.map((m) => new Date(m.mtime).getTime()));
    return bMax - aMax;
  });

  return (
    <div>
      <h1 className="text-lg font-semibold">Claude Memories</h1>

      {groups.length === 0 ? (
        <p className="mt-4 text-text-500">No memory files found.</p>
      ) : (
        groups.map((group) => (
          <div key={group.project} className="mt-6">
            <h2 className="border-b border-border-300/15 pb-1 text-sm font-semibold">
              {group.projectName}
            </h2>
            <ul className="mt-2 space-y-2">
              {group.memories.map((mem) => (
                <li key={`${mem.project}/${mem.filename}`} className="relative">
                  <Link
                    to="/memory/$project/$filename"
                    params={{ project: mem.project, filename: mem.filename }}
                    className="flex items-center justify-between rounded-md border border-border-300/15 px-4 py-3 transition-colors hover:bg-bg-200/50"
                  >
                    <span className="text-sm font-medium">{mem.title}</span>
                    <span className="ml-4 shrink-0 text-xs text-text-500">
                      {formatDate(mem.mtime)}
                    </span>
                  </Link>
                  <DebugLink
                    kind="memory"
                    relativePath={`${mem.project}/memory/${mem.filename}`}
                    className="absolute right-1 top-1"
                  />
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  );
}
