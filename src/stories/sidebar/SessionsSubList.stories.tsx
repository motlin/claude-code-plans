import type { Meta, StoryObj } from "@storybook/react-vite";
import { useCollapsedGroups } from "../../components/sidebar/hooks";
import { SessionsSubList } from "../../components/sidebar/sublists/SessionsSubList";
import { groupedSessionsQueryOptions, GroupedSessionsResponse } from "../../lib/api/sessions";
import { createStoryQueryClient, StoryWrapper } from "./decorators";

// The sidebar owns the collapse state in the app; this reuses that hook so the
// group toggles stay interactive in Storybook.
function CollapsibleSessions({ activeItemId }: { activeItemId: string | null }) {
  const [collapsedGroups, toggleGroup, revealGroup] = useCollapsedGroups();
  return (
    <SessionsSubList
      activeItemId={activeItemId}
      collapsedGroups={collapsedGroups}
      onToggleGroup={toggleGroup}
      onRevealGroup={revealGroup}
    />
  );
}

function session(id: string, title: string, projectName: string, mtime: string) {
  return {
    id,
    title,
    mtime,
    created: mtime,
    project: projectName,
    projectName,
    messageCount: 12,
    starred: false,
    state: "unknown",
    blockedSince: null,
  };
}

const groups = GroupedSessionsResponse.parse([
  {
    project: "claude-code-plans",
    projectName: "claude-code-plans",
    sessionCount: 24,
    sessions: [
      session("sess-1", "Fix sidebar layout", "claude-code-plans", "2026-04-19T10:00:00Z"),
      session("sess-2", "Add storybook stories", "claude-code-plans", "2026-04-18T09:00:00Z"),
      session("sess-3", "Refactor hooks", "claude-code-plans", "2026-04-17T08:00:00Z"),
    ],
  },
  {
    project: "reladomo",
    projectName: "reladomo",
    sessionCount: 2,
    sessions: [
      session("sess-4", "Bitemporal join regression", "reladomo", "2026-04-16T10:00:00Z"),
      session("sess-5", "Upgrade the build", "reladomo", "2026-04-15T10:00:00Z"),
    ],
  },
]);

const meta = {
  title: "Sidebar/SessionsSubList",
  component: SessionsSubList,
} satisfies Meta<typeof SessionsSubList>;

export default meta;
type Story = StoryObj;

export const MultipleProjects: Story = {
  render: () => {
    const queryClient = createStoryQueryClient();
    queryClient.setQueryData(groupedSessionsQueryOptions().queryKey, groups);
    return (
      <StoryWrapper queryClient={queryClient}>
        <CollapsibleSessions activeItemId="sess-1" />
      </StoryWrapper>
    );
  },
};

export const SingleProject: Story = {
  render: () => {
    const queryClient = createStoryQueryClient();
    queryClient.setQueryData(groupedSessionsQueryOptions().queryKey, groups.slice(0, 1));
    return (
      <StoryWrapper queryClient={queryClient}>
        <CollapsibleSessions activeItemId={null} />
      </StoryWrapper>
    );
  },
};

export const Loading: Story = {
  render: () => {
    const queryClient = createStoryQueryClient({ enabled: false });
    return (
      <StoryWrapper queryClient={queryClient}>
        <CollapsibleSessions activeItemId={null} />
      </StoryWrapper>
    );
  },
};

export const Empty: Story = {
  render: () => {
    const queryClient = createStoryQueryClient();
    queryClient.setQueryData(groupedSessionsQueryOptions().queryKey, []);
    return (
      <StoryWrapper queryClient={queryClient}>
        <CollapsibleSessions activeItemId={null} />
      </StoryWrapper>
    );
  },
};
