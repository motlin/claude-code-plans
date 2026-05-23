import type { Meta, StoryObj } from "@storybook/react-vite";
import { TaskStopRenderer } from "../../../components/tool-renderers/task-stop-renderer";
import type { ClientToolCall } from "../../../components/tool-renderers/types";

function makeToolCall(
  overrides: Partial<ClientToolCall> & { input: ClientToolCall["input"] },
): ClientToolCall {
  return {
    id: "tool-ts-1",
    name: "TaskStop",
    param: "",
    sourceUuid: "uuid-1",
    ...overrides,
  };
}

const meta = {
  title: "Session Detail/Tool Renderers/TaskStopRenderer",
  component: TaskStopRenderer,
} satisfies Meta<typeof TaskStopRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const StoppedBashTask: Story = {
  args: {
    toolCall: makeToolCall({
      input: { task_id: "br5e8me8g" },
      result: JSON.stringify({
        message: "Successfully stopped task: br5e8me8g (sleep 500)",
        task_id: "br5e8me8g",
        task_type: "local_bash",
        command: "sleep 500",
      }),
    }),
  },
};

export const StoppedAgentTask: Story = {
  args: {
    toolCall: makeToolCall({
      input: { task_id: "a13078a3fbcc95fef" },
      result: JSON.stringify({
        message: "Successfully stopped task: a13078a3fbcc95fef (Long-running agent to stop)",
        task_id: "a13078a3fbcc95fef",
        task_type: "local_agent",
        command: "Long-running agent to stop",
      }),
    }),
  },
};

export const TaskNotFound: Story = {
  args: {
    toolCall: makeToolCall({
      input: { task_id: "nonexistent-task-12345" },
      result: "Error: No task found with ID: nonexistent-task-12345",
      isError: true,
    }),
  },
};

export const MissingTaskId: Story = {
  args: {
    toolCall: makeToolCall({
      input: {},
      result: "Error: Missing required parameter: task_id",
      isError: true,
    }),
  },
};

export const Pending: Story = {
  args: {
    toolCall: makeToolCall({
      input: { task_id: "bovj87vle" },
    }),
  },
};
