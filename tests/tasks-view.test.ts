import { describe, expect, it } from "vite-plus/test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentRenderer } from "../src/components/tool-renderers/agent-renderer";
import { extractTasks, TasksView } from "../src/components/tasks-view";
import type { ClientToolCall } from "../src/components/tool-renderers/types";

function makeToolCall(name: string, input: ClientToolCall["input"]): ClientToolCall {
  return {
    id: crypto.randomUUID(),
    name,
    input,
    param: "",
    result: "",
    sourceUuid: "",
  };
}

describe("extractTasks", () => {
  it("extracts tasks from TaskCreate calls", () => {
    const calls = [
      makeToolCall("TaskCreate", {
        subject: "Build auth",
        description: "Add JWT",
      }),
      makeToolCall("TaskCreate", { subject: "Add tests" }),
    ];
    expect(extractTasks(calls)).toStrictEqual([
      {
        id: "1",
        subject: "Build auth",
        description: "Add JWT",
        status: "pending",
      },
      { id: "2", subject: "Add tests", description: "", status: "pending" },
    ]);
  });

  it("applies TaskUpdate status changes", () => {
    const calls = [
      makeToolCall("TaskCreate", { subject: "Task A" }),
      makeToolCall("TaskUpdate", { taskId: "1", status: "in_progress" }),
      makeToolCall("TaskUpdate", { taskId: "1", status: "completed" }),
    ];
    expect(extractTasks(calls)).toStrictEqual([
      { id: "1", subject: "Task A", description: "", status: "completed" },
    ]);
  });

  it("ignores TaskUpdate for unknown task IDs", () => {
    const calls = [
      makeToolCall("TaskCreate", { subject: "Task A" }),
      makeToolCall("TaskUpdate", { taskId: "99", status: "completed" }),
    ];
    expect(extractTasks(calls)).toStrictEqual([
      { id: "1", subject: "Task A", description: "", status: "pending" },
    ]);
  });

  it("returns empty array when no task calls exist", () => {
    const calls = [
      makeToolCall("Bash", { command: "echo hi" }),
      makeToolCall("Read", { file_path: "/tmp/foo" }),
    ];
    expect(extractTasks(calls)).toStrictEqual([]);
  });

  it("ignores invalid status values in TaskUpdate", () => {
    const calls = [
      makeToolCall("TaskCreate", { subject: "Task A" }),
      makeToolCall("TaskUpdate", { taskId: "1", status: "invalid_status" }),
    ];
    expect(extractTasks(calls)).toStrictEqual([
      { id: "1", subject: "Task A", description: "", status: "pending" },
    ]);
  });
});

describe("Agent effort rendering", () => {
  it("shows effort in Agent tool details", () => {
    const html = renderToStaticMarkup(
      createElement(AgentRenderer, {
        toolCall: makeToolCall("Agent", {
          prompt: "Inspect the code",
          subagent_type: "Explore",
          effort: "high",
        }),
      }),
    );

    expect(html).toContain("effort: high");
  });

  it("shows effort on agent cards in the Tasks view", () => {
    const html = renderToStaticMarkup(
      createElement(TasksView, {
        toolCalls: [
          makeToolCall("Agent", {
            description: "Inspect the code",
            subagent_type: "Explore",
            effort: "high",
          }),
        ],
      }),
    );

    expect(html).toContain(">high effort<");
  });
});
