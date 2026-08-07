import type { Meta, StoryObj } from "@storybook/react-vite";
import { PluginsSubList } from "../../components/sidebar/sublists/PluginsSubList";
import { pluginsQueryOptions, userCommandsQueryOptions } from "../../lib/api/plugins";
import { createStoryQueryClient, StoryWrapper } from "./decorators";

const meta = {
  title: "Sidebar/PluginsSubList",
  component: PluginsSubList,
} satisfies Meta<typeof PluginsSubList>;

export default meta;
type Story = StoryObj;

export const WithItems: Story = {
  render: () => {
    const queryClient = createStoryQueryClient();
    queryClient.setQueryData(pluginsQueryOptions.queryKey, [
      {
        id: "plugin-1",
        name: "Git Workflow",
        version: "1.0.0",
        versionKind: "release",
        description: "Git helpers",
        author: "user",
        marketplace: "claude-plugins-official",
        installPath: "/path",
        agents: [],
        commands: [],
        skills: [],
      },
      {
        id: "plugin-2",
        name: "Code Quality",
        version: "1.0.0",
        versionKind: "release",
        description: "Linting tools",
        author: "user",
        marketplace: "community-tools",
        installPath: "/path",
        agents: [],
        commands: [],
        skills: [],
      },
    ]);
    queryClient.setQueryData(userCommandsQueryOptions.queryKey, [
      {
        source: "user",
        sourceName: "User",
        commands: [
          {
            filename: "deploy.md",
            name: "/deploy",
            description: "Deploy app",
            type: "command" as const,
            frontmatter: {},
          },
        ],
      },
    ]);
    return (
      <StoryWrapper queryClient={queryClient}>
        <PluginsSubList />
      </StoryWrapper>
    );
  },
};

export const Empty: Story = {
  render: () => {
    const queryClient = createStoryQueryClient();
    queryClient.setQueryData(pluginsQueryOptions.queryKey, [] as never[]);
    queryClient.setQueryData(userCommandsQueryOptions.queryKey, [] as never[]);
    return (
      <StoryWrapper queryClient={queryClient}>
        <PluginsSubList />
      </StoryWrapper>
    );
  },
};

export const Loading: Story = {
  render: () => {
    const queryClient = createStoryQueryClient({ enabled: false });
    return (
      <StoryWrapper queryClient={queryClient}>
        <PluginsSubList />
      </StoryWrapper>
    );
  },
};
