import type { Meta, StoryObj } from "@storybook/react-vite";
import { TaskGetRenderer } from "../../../components/tool-renderers/task-get-renderer";
import type { ClientToolCall } from "../../../components/tool-renderers/types";

function makeToolCall(
  overrides: Partial<ClientToolCall> & { input: ClientToolCall["input"] },
): ClientToolCall {
  return {
    id: "tool-task-get-1",
    name: "TaskGet",
    param: "",
    sourceUuid: "uuid-1",
    ...overrides,
  };
}

const meta = {
  title: "Session Detail/Tool Renderers/TaskGetRenderer",
  component: TaskGetRenderer,
} satisfies Meta<typeof TaskGetRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = {
  args: {
    toolCall: makeToolCall({
      input: { taskId: "12" },
      result: "Task #12: Implement user authentication\nstatus: in_progress\nBlocked by: #10, #11",
    }),
  },
};

export const Error: Story = {
  args: {
    toolCall: makeToolCall({
      input: { taskId: "999" },
      result: "Error: Task #999 not found",
      isError: true,
    }),
  },
};
