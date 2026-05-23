import type { Meta, StoryObj } from "@storybook/react-vite";
import { TaskDependencyGraph } from "../../components/task-dependency-graph";
import type { GraphTask, TaskGraphGroup } from "../../components/task-dependency-graph";

function makeTask(
  overrides: Partial<GraphTask> & Pick<GraphTask, "taskId" | "subject">,
): GraphTask {
  return {
    projectDir: "/project",
    status: "pending",
    blocks: [],
    blockedBy: [],
    ...overrides,
  };
}

const tasksWithDeps: GraphTask[] = [
  makeTask({
    taskId: "1",
    subject: "Set up database",
    status: "completed",
    blocks: ["2", "3"],
  }),
  makeTask({
    taskId: "2",
    subject: "Build API layer",
    status: "in_progress",
    blockedBy: ["1"],
    blocks: ["4"],
  }),
  makeTask({
    taskId: "3",
    subject: "Design UI mockups",
    status: "completed",
    blockedBy: ["1"],
    blocks: ["4"],
  }),
  makeTask({
    taskId: "4",
    subject: "Integrate frontend",
    status: "pending",
    blockedBy: ["2", "3"],
  }),
];

const circularTasks: GraphTask[] = [
  makeTask({ taskId: "a", subject: "Task A", blockedBy: ["c"], blocks: ["b"] }),
  makeTask({ taskId: "b", subject: "Task B", blockedBy: ["a"], blocks: ["c"] }),
  makeTask({ taskId: "c", subject: "Task C", blockedBy: ["b"], blocks: ["a"] }),
];

const groups: TaskGraphGroup[] = [{ projectDir: "/project", tasks: tasksWithDeps }];
const circularGroups: TaskGraphGroup[] = [{ projectDir: "/project", tasks: circularTasks }];
const emptyGroups: TaskGraphGroup[] = [{ projectDir: "/project", tasks: [] }];

const meta = {
  title: "Tasks/TaskDependencyGraph",
  component: TaskDependencyGraph,
} satisfies Meta<typeof TaskDependencyGraph>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithDependencies: Story = {
  args: { groups },
};

export const NoTasks: Story = {
  args: { groups: emptyGroups },
};

export const CircularDependency: Story = {
  args: { groups: circularGroups },
};
