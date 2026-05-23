import type { Meta, StoryObj } from "@storybook/react-vite";
import { ProjectsSubList } from "../../components/sidebar/sublists/ProjectsSubList";
import { projectsQueryOptions } from "../../lib/api/projects";
import { createStoryQueryClient, StoryWrapper } from "./decorators";

const meta = {
  title: "Sidebar/ProjectsSubList",
  component: ProjectsSubList,
} satisfies Meta<typeof ProjectsSubList>;

export default meta;
type Story = StoryObj;

export const WithProjects: Story = {
  render: () => {
    const queryClient = createStoryQueryClient();
    queryClient.setQueryData(projectsQueryOptions().queryKey, [
      {
        id: "proj-1",
        name: "claude-code-plans",
        projectPath: "/home/user/claude-code-plans",
        sessionCount: 5,
        memoryCount: 2,
        planCount: 1,
        taskCount: 3,
        activeCount: 1,
        lastActivity: "2026-04-19T10:00:00Z",
      },
      {
        id: "proj-2",
        name: "other-project",
        projectPath: "/home/user/other",
        sessionCount: 3,
        memoryCount: 0,
        planCount: 0,
        taskCount: 0,
        activeCount: 0,
        lastActivity: "2026-04-18T09:00:00Z",
      },
    ]);
    return (
      <StoryWrapper queryClient={queryClient}>
        <ProjectsSubList activeItemId="proj-1" />
      </StoryWrapper>
    );
  },
};

export const Empty: Story = {
  render: () => {
    const queryClient = createStoryQueryClient();
    queryClient.setQueryData(projectsQueryOptions().queryKey, [] as never[]);
    return (
      <StoryWrapper queryClient={queryClient}>
        <ProjectsSubList activeItemId={null} />
      </StoryWrapper>
    );
  },
};

export const Loading: Story = {
  render: () => {
    const queryClient = createStoryQueryClient({ enabled: false });
    return (
      <StoryWrapper queryClient={queryClient}>
        <ProjectsSubList activeItemId={null} />
      </StoryWrapper>
    );
  },
};
