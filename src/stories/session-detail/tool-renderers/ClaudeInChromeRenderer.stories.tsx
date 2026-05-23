import type { Meta, StoryObj } from "@storybook/react-vite";
import { ClaudeInChromeRenderer } from "../../../components/tool-renderers/claude-in-chrome-renderer";
import type { ClientToolCall } from "../../../components/tool-renderers/types";

function makeToolCall(
  overrides: Partial<ClientToolCall> & { input: ClientToolCall["input"] },
): ClientToolCall {
  return {
    id: "tool-chrome-1",
    name: "mcp__claude-in-chrome__navigate",
    param: "",
    sourceUuid: "uuid-1",
    ...overrides,
  };
}

const meta = {
  title: "Session Detail/Tool Renderers/ClaudeInChromeRenderer",
  component: ClaudeInChromeRenderer,
} satisfies Meta<typeof ClaudeInChromeRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = {
  args: {
    toolCall: makeToolCall({
      input: { url: "https://docs.example.com/api" },
      result: "Navigated to https://docs.example.com/api\nPage loaded successfully.",
    }),
  },
};

export const Error: Story = {
  args: {
    toolCall: makeToolCall({
      name: "mcp__claude-in-chrome__computer",
      input: { action: "click", coordinate: [150, 300] },
      result: "Error: No element found at coordinates (150, 300). The page may have changed.",
      isError: true,
    }),
  },
};
