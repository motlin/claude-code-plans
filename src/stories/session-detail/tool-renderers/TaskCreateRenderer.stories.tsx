import type { Meta, StoryObj } from "@storybook/react-vite";
import { TaskCreateRenderer } from "../../../components/tool-renderers/task-create-renderer";
import type { ClientToolCall } from "../../../components/tool-renderers/types";

function makeToolCall(
  overrides: Partial<ClientToolCall> & { input: ClientToolCall["input"] },
): ClientToolCall {
  return {
    id: "tool-task-create-1",
    name: "TaskCreate",
    param: "",
    sourceUuid: "uuid-1",
    ...overrides,
  };
}

const meta = {
  title: "Session Detail/Tool Renderers/TaskCreateRenderer",
  component: TaskCreateRenderer,
} satisfies Meta<typeof TaskCreateRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = {
  args: {
    toolCall: makeToolCall({
      input: {
        subject: "Implement user authentication",
        description: "Add JWT-based auth with refresh tokens",
        status: "pending",
      },
      result: "Created task #5",
    }),
  },
};

export const Error: Story = {
  args: {
    toolCall: makeToolCall({
      input: { subject: "Invalid task" },
      result: "Error: Failed to create task — subject must be non-empty",
      isError: true,
    }),
  },
};
