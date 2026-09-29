import type { Meta, StoryObj } from "@storybook/react-vite";
import { SessionGroups } from "../../components/sidebar/session-groups";
import { RecentSessionsResponse, recentSessionsInfiniteQueryOptions } from "../../lib/api/sessions";
import type { SessionBucket } from "../../lib/session-state";
import { createStoryQueryClient, StoryWrapper } from "./decorators";

const MINUTE = 60 * 1000;

function session(id: string, title: string, bucket: SessionBucket, minutesAgo: number) {
  const mtime = new Date(Date.now() - minutesAgo * MINUTE).toISOString();
  return {
    id,
    title,
    mtime,
    created: mtime,
    project: "claude-code-plans",
    projectName: "claude-code-plans",
    messageCount: 12,
    archived: false,
    state: bucket === "working" ? "working" : bucket === "blocked" ? "waiting" : "idle",
    bucket,
    liveAgentCount: 0,
    unseen: bucket === "review",
    blockedSince: null,
  };
}

const sessions = [
  session("sess-1", "Approve the migration plan", "blocked", 2),
  session("sess-2", "Fix sidebar layout", "review", 5),
  session("sess-3", "Refactor the hook dispatcher to ignore subagent events", "working", 1),
  ...Array.from({ length: 24 }, (_, index) =>
    session(`done-${index}`, `Completed session ${index + 1}`, "done", 30 + index * 60),
  ),
];

function seed(nextCursor: string | null = null) {
  const queryClient = createStoryQueryClient();
  queryClient.setQueryData(recentSessionsInfiniteQueryOptions().queryKey, {
    pages: [RecentSessionsResponse.parse({ sessions, nextCursor })],
    pageParams: [null],
  });
  return queryClient;
}

const meta = {
  title: "Sidebar/SessionGroups",
  component: SessionGroups,
} satisfies Meta<typeof SessionGroups>;

export default meta;
type Story = StoryObj;

export const ByState: Story = {
  render: () => (
    <StoryWrapper queryClient={seed()}>
      <SessionGroups activeItemId="sess-2" />
    </StoryWrapper>
  ),
};

export const WithMorePages: Story = {
  render: () => (
    <StoryWrapper queryClient={seed("cursor-2")}>
      <SessionGroups activeItemId={null} />
    </StoryWrapper>
  ),
};

export const Loading: Story = {
  render: () => (
    <StoryWrapper queryClient={createStoryQueryClient({ enabled: false })}>
      <SessionGroups activeItemId={null} />
    </StoryWrapper>
  ),
};
