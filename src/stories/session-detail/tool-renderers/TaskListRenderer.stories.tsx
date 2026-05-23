import type { Meta, StoryObj } from "@storybook/react-vite";
import { TaskListRenderer } from "../../../components/tool-renderers/task-list-renderer";
import type { ClientToolCall } from "../../../components/tool-renderers/types";

function makeToolCall(
  overrides: Partial<ClientToolCall> & { input: ClientToolCall["input"] },
): ClientToolCall {
  return {
    id: "tool-task-list-1",
    name: "TaskList",
    param: "",
    sourceUuid: "uuid-1",
    ...overrides,
  };
}

const meta = {
  title: "Session Detail/Tool Renderers/TaskListRenderer",
  component: TaskListRenderer,
} satisfies Meta<typeof TaskListRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = {
  args: {
    toolCall: makeToolCall({
      input: {},
      result:
        "#1 [completed] Set up project scaffolding\n#2 [in_progress] Implement database schema\n#3 [pending] Add API endpoints",
    }),
  },
};

export const NoTasks: Story = {
  args: {
    toolCall: makeToolCall({
      input: {},
      result: "No tasks found",
    }),
  },
};

export const Pending: Story = {
  args: {
    toolCall: makeToolCall({
      input: {},
    }),
  },
};

export const Error: Story = {
  args: {
    toolCall: makeToolCall({
      input: {},
      result: "Failed to list tasks: permission denied",
      isError: true,
    }),
  },
};

export const ManyTasks: Story = {
  args: {
    toolCall: makeToolCall({
      input: {},
      result: Array.from({ length: 12 }, (_, i) => {
        const statuses = ["completed", "in_progress", "pending"];
        const status = statuses[i % 3]!;
        return `#${i + 1} [${status}] Task ${i + 1}: ${["Fix login bug", "Add unit tests", "Deploy to staging", "Refactor database layer", "Update documentation", "Add error handling", "Optimize queries", "Add caching", "Setup CI/CD", "Write integration tests", "Add monitoring", "Fix memory leak"][i]}`;
      }).join("\n"),
    }),
  },
};
