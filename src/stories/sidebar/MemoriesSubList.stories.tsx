import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { MemoriesSubList } from "../../components/sidebar/sublists/MemoriesSubList";
import { MemoryListResponse, projectMemoriesQueryOptions } from "../../lib/api/memories";
import { projectsQueryOptions } from "../../lib/api/projects";
import { createStoryQueryClient, StoryWrapper } from "./decorators";

// The sidebar owns the collapse state in the app; this mirrors that wiring so
// the group toggles stay interactive in Storybook.
function CollapsibleMemories({ activeItemId }: { activeItemId: string | null }) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  return (
    <MemoriesSubList
      activeItemId={activeItemId}
      collapsedGroups={collapsedGroups}
      onToggleGroup={(projectId) =>
        setCollapsedGroups((previous) => {
          const next = new Set(previous);
          if (next.has(projectId)) {
            next.delete(projectId);
          } else {
            next.add(projectId);
          }
          return next;
        })
      }
    />
  );
}

const meta = {
  title: "Sidebar/MemoriesSubList",
  component: MemoriesSubList,
} satisfies Meta<typeof MemoriesSubList>;

export default meta;
type Story = StoryObj;

export const MultipleProjects: Story = {
  render: () => {
    const queryClient = createStoryQueryClient();
    queryClient.setQueryData(projectsQueryOptions().queryKey, [
      {
        id: "project-one",
        name: "Claude Code Browser",
        projectPath: "/projects/browser",
        sessionCount: 3,
        memoryCount: 2,
        planCount: 1,
        taskCount: 0,
        activeCount: 0,
        lastActivity: "2026-08-05T10:00:00Z",
      },
      {
        id: "project-two",
        name: "Documentation",
        projectPath: "/projects/docs",
        sessionCount: 2,
        memoryCount: 1,
        planCount: 0,
        taskCount: 0,
        activeCount: 0,
        lastActivity: "2026-08-06T10:00:00Z",
      },
    ]);
    queryClient.setQueryData(
      projectMemoriesQueryOptions("project-one").queryKey,
      MemoryListResponse.parse({
        project: {
          id: "project-one",
          name: "Claude Code Browser",
          projectPath: "/projects/browser",
        },
        memories: [
          {
            filename: "sidebar.md",
            title: "Sidebar conventions",
            mtime: "2026-08-05T10:00:00Z",
            project: "project-one",
          },
          {
            filename: "queries.md",
            title: "Query conventions",
            mtime: "2026-08-04T10:00:00Z",
            project: "project-one",
          },
        ],
      }),
    );
    queryClient.setQueryData(
      projectMemoriesQueryOptions("project-two").queryKey,
      MemoryListResponse.parse({
        project: {
          id: "project-two",
          name: "Documentation",
          projectPath: "/projects/docs",
        },
        memories: [
          {
            filename: "style.md",
            title: "Writing style",
            mtime: "2026-08-06T10:00:00Z",
            project: "project-two",
          },
        ],
      }),
    );

    return (
      <StoryWrapper queryClient={queryClient}>
        <CollapsibleMemories activeItemId={null} />
      </StoryWrapper>
    );
  },
};

export const Loading: Story = {
  render: () => {
    const queryClient = createStoryQueryClient({ enabled: false });
    return (
      <StoryWrapper queryClient={queryClient}>
        <CollapsibleMemories activeItemId={null} />
      </StoryWrapper>
    );
  },
};
