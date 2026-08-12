import type { Meta, StoryObj } from "@storybook/react-vite";
import { EnterPlanModeRenderer } from "../../../components/tool-renderers/enter-plan-mode-renderer";
import type { ClientToolCall } from "../../../components/tool-renderers/types";

function makeToolCall(
  overrides: Partial<ClientToolCall> & { input: ClientToolCall["input"] },
): ClientToolCall {
  return {
    id: "tool-epm-1",
    name: "EnterPlanMode",
    param: "",
    sourceUuid: "uuid-1",
    ...overrides,
  };
}

const meta = {
  title: "Session Detail/Tool Renderers/EnterPlanModeRenderer",
  component: EnterPlanModeRenderer,
} satisfies Meta<typeof EnterPlanModeRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    toolCall: makeToolCall({
      input: {},
      result:
        "Entered plan mode. You should now focus on exploring the codebase and designing an implementation approach.\n\nIn plan mode, you should:\n1. Thoroughly explore the codebase to understand existing patterns\n2. Identify similar features and architectural approaches\n\nRemember: DO NOT write or edit any files yet.",
    }),
  },
};

export const Failed: Story = {
  args: {
    toolCall: makeToolCall({
      input: {},
      result: "You are already in plan mode.",
      isError: true,
    }),
  },
};
