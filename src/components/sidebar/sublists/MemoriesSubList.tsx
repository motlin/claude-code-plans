import { useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useEffect } from "react";
import { projectMemoriesQueryOptions, type MemoryListItem } from "../../../lib/api/memories";
import { projectsQueryOptions } from "../../../lib/api/projects";
import { toMdSlug } from "../../../lib/md-slug";
import { LoadingBars } from "../primitives/LoadingBars";

interface MemoryGroup {
  projectId: string;
  projectName: string;
  memories: MemoryListItem[];
}

function latestMemoryTime(group: MemoryGroup): number {
  return Math.max(...group.memories.map((memory) => new Date(memory.mtime).getTime()));
}

/**
 * `collapsedGroups` lives in `Sidebar` because opening an item in another
 * section collapses — and unmounts — this sublist; local state would come back
 * expand-all'd. The group holding the open memory reveals itself through
 * `onRevealGroup`, which leaves it collapsible again afterwards.
 */
export function MemoriesSubList({
  activeItemId,
  collapsedGroups,
  onToggleGroup,
  onRevealGroup,
}: {
  activeItemId: string | null;
  collapsedGroups: ReadonlySet<string>;
  onToggleGroup: (projectId: string) => void;
  onRevealGroup: (projectId: string) => void;
}) {
  const { data: projects } = useQuery(projectsQueryOptions());
  const memoryQueries = useQueries({
    queries: projects?.map((project) => projectMemoriesQueryOptions(project.id)) ?? [],
  });

  let groups: MemoryGroup[] | undefined;
  if (projects && memoryQueries.every((query) => query.data !== undefined)) {
    groups = memoryQueries
      .flatMap((query) => {
        const data = query.data;
        if (!data || data.memories.length === 0) return [];
        return [
          {
            projectId: data.project.id,
            projectName: data.project.name,
            memories: data.memories,
          },
        ];
      })
      .sort((first, second) => latestMemoryTime(second) - latestMemoryTime(first));
  }

  const activeGroupId = groups?.find((group) =>
    group.memories.some((memory) => `${memory.project}/${memory.filename}` === activeItemId),
  )?.projectId;

  // Reveal the group holding the open memory once, rather than deriving its
  // expansion — a derived reveal would swallow every click on that group's
  // chevron, the one group the reader is most likely to reach for.
  useEffect(() => {
    if (!activeGroupId) return;
    onRevealGroup(activeGroupId);
  }, [activeGroupId, onRevealGroup]);

  if (groups === undefined) {
    return (
      <div className="pl-10">
        <LoadingBars />
      </div>
    );
  }

  if (groups.length === 0) return null;

  if (groups.length === 1 && groups[0]) {
    return (
      <div className="pl-10">
        {groups[0].memories.map((memory) => (
          <MemoryLink
            key={`${memory.project}/${memory.filename}`}
            memory={memory}
            activeItemId={activeItemId}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="pl-10">
      {groups.map((group) => {
        const isExpanded = !collapsedGroups.has(group.projectId);
        return (
          <div key={group.projectId}>
            <button
              type="button"
              onClick={() => onToggleGroup(group.projectId)}
              className="mb-px flex w-full items-center gap-1 rounded-[4px] px-2 py-1 text-xs text-text-500 transition-colors hover:bg-bg-300/50 hover:text-text-200"
            >
              <ChevronRight
                className="h-2.5 w-2.5 shrink-0 transition-transform duration-200"
                style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}
              />
              <span className="truncate font-medium">{group.projectName}</span>
              <span className="ml-auto shrink-0 text-[10px] opacity-60">
                {group.memories.length}
              </span>
            </button>
            {isExpanded &&
              group.memories.map((memory) => (
                <MemoryLink
                  key={`${memory.project}/${memory.filename}`}
                  memory={memory}
                  activeItemId={activeItemId}
                  nested
                />
              ))}
          </div>
        );
      })}
    </div>
  );
}

function MemoryLink({
  memory,
  activeItemId,
  nested = false,
}: {
  memory: MemoryListItem;
  activeItemId: string | null;
  nested?: boolean;
}) {
  const isActive = `${memory.project}/${memory.filename}` === activeItemId;
  return (
    <Link
      to="/memory/$project/$filename"
      params={{ project: memory.project, filename: toMdSlug(memory.filename) }}
      className={`mb-px block truncate rounded-[4px] py-1 text-xs no-underline transition-colors ${
        nested ? "pl-5 pr-2" : "px-2"
      } ${
        isActive
          ? "bg-bg-300/50 font-medium text-text-000"
          : "text-text-500 hover:bg-bg-300/50 hover:text-text-200"
      }`}
    >
      {memory.title}
    </Link>
  );
}
