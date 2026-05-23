import type { Meta, StoryObj } from "@storybook/react-vite";
import { TerminalOutput } from "../../../components/tool-renderers/shared";

const meta = {
  title: "Session Detail/Tool Renderers/TerminalOutput",
  component: TerminalOutput,
} satisfies Meta<typeof TerminalOutput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = {
  args: {
    content: "Building project...\nCompiled 42 modules in 1.3s\nDone.",
  },
};

export const AnsiCodes: Story = {
  args: {
    content:
      "\x1b[32m PASS \x1b[39m src/app.test.ts\n\x1b[31m FAIL \x1b[39m src/utils.test.ts\n\x1b[1m\x1b[33mWarning:\x1b[39m\x1b[22m 1 test skipped",
  },
};
