import type { Meta, StoryObj } from "@storybook/react-vite";
import { TodoWriteRenderer } from "../../../components/tool-renderers/todo-write-renderer";
import type { ClientToolCall } from "../../../components/tool-renderers/types";

function makeToolCall(
  overrides: Partial<ClientToolCall> & { input: ClientToolCall["input"] },
): ClientToolCall {
  return {
    id: "tool-todo-1",
    name: "TodoWrite",
    param: "",
    sourceUuid: "uuid-1",
    ...overrides,
  };
}

const MULTIPLE_TODOS = makeToolCall({
  input: {
    todos: [
      { id: "1", content: "Fix login bug", status: "in_progress", activeForm: "Fixing login bug" },
      { id: "2", content: "Write tests", status: "pending", activeForm: "Writing tests" },
      { id: "3", content: "Update docs", status: "completed", activeForm: "Updating docs" },
    ],
  },
  result: "Updated 3 todos",
});

const meta = {
  title: "Session Detail/Tool Renderers/TodoWriteRenderer",
  component: TodoWriteRenderer,
} satisfies Meta<typeof TodoWriteRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Default view: upstream draws no checklist, only the activity line survives. */
export const MultipleTodos: Story = {
  args: { toolCall: MULTIPLE_TODOS },
};

/** Verbose preset restores the full checklist a live console shows elsewhere. */
export const MultipleTodosVerbose: Story = {
  args: { toolCall: MULTIPLE_TODOS, verbose: true },
};

export const SingleTodo: Story = {
  args: {
    toolCall: makeToolCall({
      input: {
        todos: [
          {
            id: "1",
            content: "Fix critical bug",
            status: "in_progress",
            activeForm: "Fixing critical bug",
          },
        ],
      },
      result: "Updated 1 todo",
    }),
  },
};

export const Error: Story = {
  args: {
    toolCall: makeToolCall({
      input: { todos: [] },
      result: "Error: Failed to write todos",
      isError: true,
    }),
  },
};
