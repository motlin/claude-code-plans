import { describe, expect, it } from "vite-plus/test";
import { filterTasks, taskMatchesSearch, type SearchableTask } from "../src/lib/task-search";

const tasks: SearchableTask[] = [
  {
    taskId: "task-1",
    subject: "Build the API",
    description: "Add an example endpoint",
    activeForm: null,
    owner: "alice",
  },
  {
    taskId: "task-2",
    subject: "Write tests",
    description: "Cover the endpoint",
    activeForm: "Testing the API",
    owner: "bob",
  },
];

describe("task search", () => {
  it("matches task owner case-insensitively", () => {
    expect(filterTasks(tasks, "ALICE")).toStrictEqual([tasks[0]]);
  });

  it("matches the other displayed task fields", () => {
    expect([
      taskMatchesSearch(tasks[0]!, "task-1"),
      taskMatchesSearch(tasks[0]!, "build"),
      taskMatchesSearch(tasks[0]!, "example endpoint"),
      taskMatchesSearch(tasks[1]!, "testing"),
      taskMatchesSearch(tasks[0]!, "missing"),
    ]).toStrictEqual([true, true, true, true, false]);
  });

  it("returns every task for an empty query", () => {
    expect(filterTasks(tasks, "  ")).toStrictEqual(tasks);
  });
});
