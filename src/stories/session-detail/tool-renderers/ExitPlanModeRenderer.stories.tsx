import type { Meta, StoryObj } from "@storybook/react-vite";
import { ExitPlanModeRenderer } from "../../../components/tool-renderers/exit-plan-mode-renderer";
import type { ClientToolCall } from "../../../components/tool-renderers/types";
import { withRouterAndQuery } from "../../sidebar/decorators";

function makeToolCall(
  overrides: Partial<ClientToolCall> & { input: ClientToolCall["input"] },
): ClientToolCall {
  return {
    id: "tool-epm-1",
    name: "ExitPlanMode",
    param: "",
    sourceUuid: "uuid-1",
    ...overrides,
  };
}

const meta = {
  title: "Session Detail/Tool Renderers/ExitPlanModeRenderer",
  component: ExitPlanModeRenderer,
  decorators: [withRouterAndQuery],
} satisfies Meta<typeof ExitPlanModeRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = {
  args: {
    toolCall: makeToolCall({
      input: {},
      result: "Plan saved to ~/.claude/plans/refactor-auth-module.md",
    }),
  },
};

export const Error: Story = {
  args: {
    toolCall: makeToolCall({
      input: {},
      result: "Exited plan mode without saving.",
    }),
  },
};
