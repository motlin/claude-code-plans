import type { Meta, StoryObj } from "@storybook/react-vite";
import { WebSearchRenderer } from "../../../components/tool-renderers/web-search-renderer";
import type { ClientToolCall } from "../../../components/tool-renderers/types";

function makeToolCall(
  overrides: Partial<ClientToolCall> & { input: ClientToolCall["input"] },
): ClientToolCall {
  return {
    id: "tool-ws-1",
    name: "WebSearch",
    param: "",
    sourceUuid: "uuid-1",
    ...overrides,
  };
}

const meta = {
  title: "Session Detail/Tool Renderers/WebSearchRenderer",
  component: WebSearchRenderer,
} satisfies Meta<typeof WebSearchRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const BasicSearch: Story = {
  args: {
    toolCall: makeToolCall({
      input: {
        query: "TanStack Start SSR configuration",
      },
      result:
        "1. https://tanstack.com/start/latest/docs/ssr\n2. https://github.com/TanStack/router/discussions/1234",
    }),
  },
};

export const WithDomainFilter: Story = {
  args: {
    toolCall: makeToolCall({
      input: {
        query: "React Server Components",
        allowed_domains: ["react.dev", "github.com"],
      },
      result: "1. https://react.dev/reference/rsc/server-components",
    }),
  },
};

export const Error: Story = {
  args: {
    toolCall: makeToolCall({
      input: { query: "test query" },
      result: "Error: Search failed",
      isError: true,
    }),
  },
};
