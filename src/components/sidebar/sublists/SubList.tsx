import { Link } from "@tanstack/react-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import { projectsQueryOptions } from "../../../lib/api/projects";
import { projectMemoriesQueryOptions } from "../../../lib/api/memories";
import { recentSessionsQueryOptions } from "../../../lib/api/sessions";
import { toMdSlug } from "../../../lib/md-slug";
import type { Section, SubItem } from "../types";
import { LoadingBars } from "../primitives/LoadingBars";

// SubList is the fallback renderer for sidebar sections without a dedicated
// component. Sidebar.tsx routes active/projects/plans/plugins to their own
// sublists, so only `memories` and `sessions` actually reach this component.
export function SubList({
  section,
  activeItemId,
}: {
  section: Section;
  activeItemId: string | null;
}) {
  const projectsQuery = useQuery({
    ...projectsQueryOptions(),
    enabled: section === "memories",
  });
  const memoryQueries = useQueries({
    queries:
      section === "memories" && projectsQuery.data
        ? projectsQuery.data.map((p) => ({
            ...projectMemoriesQueryOptions(p.id),
            enabled: true,
          }))
        : [],
  });
  const sessionsQuery = useQuery({
    ...recentSessionsQueryOptions(20),
    enabled: section === "sessions",
  });

  let items: SubItem[] | null = null;

  if (section === "memories") {
    // every() returns true for an empty array, which correctly handles "no projects".
    if (projectsQuery.data && memoryQueries.every((q) => q.data !== undefined)) {
      items = memoryQueries
        .flatMap((q) => q.data?.memories ?? [])
        .sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime())
        .slice(0, 20)
        .map((m) => ({
          id: `${m.project}/${m.filename}`,
          label: m.title,
          to: "/memory/$project/$filename",
          params: { project: m.project, filename: toMdSlug(m.filename) },
        }));
    }
  } else if (section === "sessions") {
    if (sessionsQuery.data) {
      // Server returns the 20 most-recent sessions, already ordered.
      items = sessionsQuery.data.sessions.map((s) => ({
        id: s.id,
        label: s.title,
        to: "/session/$id",
        params: { id: s.id },
      }));
    }
  } else {
    items = [];
  }

  if (items === null) {
    return (
      <div className="pl-10">
        <LoadingBars />
      </div>
    );
  }

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="pl-10">
      {items.map((item) => {
        const isActive = item.id === activeItemId;
        return (
          <Link
            key={item.id}
            to={item.to as string}
            params={item.params}
            className={`mb-px block truncate rounded-[4px] px-2 py-1 text-xs no-underline transition-colors ${
              isActive
                ? "bg-bg-300/50 font-medium text-text-000"
                : "text-text-500 hover:bg-bg-300/50 hover:text-text-200"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
