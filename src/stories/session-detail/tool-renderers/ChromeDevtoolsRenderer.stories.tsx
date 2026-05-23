import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChromeDevtoolsRenderer } from "../../../components/tool-renderers/chrome-devtools-renderer";
import type { ClientToolCall } from "../../../components/tool-renderers/types";

function makeToolCall(
  overrides: Partial<ClientToolCall> & { input: ClientToolCall["input"] },
): ClientToolCall {
  return {
    id: "tool-cdp-1",
    name: "mcp__chrome-devtools__navigate_page",
    param: "",
    sourceUuid: "uuid-1",
    ...overrides,
  };
}

const meta = {
  title: "Session Detail/Tool Renderers/ChromeDevtoolsRenderer",
  component: ChromeDevtoolsRenderer,
} satisfies Meta<typeof ChromeDevtoolsRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = {
  args: {
    toolCall: makeToolCall({
      input: { url: "https://example.com" },
      result:
        "Successfully navigated to https://example.com\n0: https://example.com [selected]\n1: about:blank",
    }),
  },
};

export const Error: Story = {
  args: {
    toolCall: makeToolCall({
      name: "mcp__chrome-devtools__list_pages",
      input: {},
      result:
        "Error: Could not connect to Chrome DevTools. Is Chrome running with --remote-debugging-port=9222?",
      isError: true,
    }),
  },
};
