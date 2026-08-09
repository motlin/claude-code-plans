import type { Meta, StoryObj } from "@storybook/react-vite";
import { ActiveSubList } from "../../components/sidebar/sublists/ActiveSubList";
import { activeSessionsQueryOptions } from "../../lib/api/sessions";
import { createStoryQueryClient, StoryWrapper } from "./decorators";

const meta = {
  title: "Sidebar/ActiveSubList",
  component: ActiveSubList,
} satisfies Meta<typeof ActiveSubList>;

export default meta;
type Story = StoryObj;

export const Loading: Story = {
  render: () => {
    const queryClient = createStoryQueryClient({ enabled: false });
    return (
      <StoryWrapper queryClient={queryClient}>
        <ActiveSubList />
      </StoryWrapper>
    );
  },
};

export const WithSessions: Story = {
  render: () => {
    const queryClient = createStoryQueryClient();
    queryClient.setQueryData(activeSessionsQueryOptions().queryKey, [
      {
        sessionId: "sess-1",
        projectDir: "/home/user/claude-code-plans",
        projectName: "claude-code-plans",
        title: "Fix the session indexer",
        createdAt: Date.now() - 60_000,
        lastModified: Date.now(),
        state: "working",
        blockedSince: null,
      },
      {
        sessionId: "sess-2",
        projectDir: "/home/user/my-other-project",
        projectName: "my-other-project",
        title: "Investigate the flaky deploy",
        createdAt: Date.now() - 30_000,
        lastModified: Date.now(),
        state: "waiting",
        blockedSince: new Date(Date.now() - 31 * 60_000).toISOString(),
      },
    ]);
    return (
      <StoryWrapper queryClient={queryClient}>
        <ActiveSubList />
      </StoryWrapper>
    );
  },
};

export const Empty: Story = {
  render: () => {
    const queryClient = createStoryQueryClient();
    queryClient.setQueryData(activeSessionsQueryOptions().queryKey, []);
    return (
      <StoryWrapper queryClient={queryClient}>
        <ActiveSubList />
      </StoryWrapper>
    );
  },
};
