import type { Meta, StoryObj } from "@storybook/react-vite";
import { PlaywrightRenderer } from "../../../components/tool-renderers/playwright-renderer";
import type { ClientToolCall } from "../../../components/tool-renderers/types";

function makeToolCall(
  overrides: Partial<ClientToolCall> & { input: ClientToolCall["input"] },
): ClientToolCall {
  return {
    id: "tool-playwright-1",
    name: "mcp__plugin_playwright_playwright__browser_navigate",
    param: "",
    sourceUuid: "uuid-1",
    ...overrides,
  };
}

const meta = {
  title: "Session Detail/Tool Renderers/PlaywrightRenderer",
  component: PlaywrightRenderer,
} satisfies Meta<typeof PlaywrightRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = {
  args: {
    toolCall: makeToolCall({
      input: { url: "https://example.com/dashboard" },
      result:
        'Navigated to https://example.com/dashboard\n\nRootWebArea "Dashboard" url="https://example.com/dashboard"\n  heading "Welcome back"\n  button "Settings" ref=1\n  table "Recent activity"',
    }),
  },
};

export const Error: Story = {
  args: {
    toolCall: makeToolCall({
      name: "mcp__plugin_playwright_playwright__browser_click",
      input: { ref: "42" },
      result: "Error: Element ref=42 not found. The page may have changed since the last snapshot.",
      isError: true,
    }),
  },
};
