import type { Meta, StoryObj } from "@storybook/react-vite";
import { GithubRenderer } from "../../../components/tool-renderers/github-renderer";
import type { ClientToolCall } from "../../../components/tool-renderers/types";

function makeToolCall(
  overrides: Partial<ClientToolCall> & { input: ClientToolCall["input"] },
): ClientToolCall {
  return {
    id: "tool-github-1",
    name: "mcp__plugin_github_github__list_pull_requests",
    param: "",
    sourceUuid: "uuid-1",
    ...overrides,
  };
}

const meta = {
  title: "Session Detail/Tool Renderers/GithubRenderer",
  component: GithubRenderer,
} satisfies Meta<typeof GithubRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = {
  args: {
    toolCall: makeToolCall({
      input: { owner: "acme", repo: "widgets" },
      result: JSON.stringify([
        {
          number: 42,
          title: "Add dark mode support",
          state: "open",
          user: { login: "alice" },
          html_url: "https://github.com/acme/widgets/pull/42",
        },
        {
          number: 41,
          title: "Fix memory leak in cache layer",
          state: "closed",
          merged: true,
          user: { login: "bob" },
          html_url: "https://github.com/acme/widgets/pull/41",
        },
      ]),
    }),
  },
};

export const Error: Story = {
  args: {
    toolCall: makeToolCall({
      name: "mcp__plugin_github_github__get_file_contents",
      input: { owner: "acme", repo: "private-repo", path: "README.md" },
      result: '{"message":"Not Found","documentation_url":"https://docs.github.com/rest"}',
      isError: true,
    }),
  },
};
