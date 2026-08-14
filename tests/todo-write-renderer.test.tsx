// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { TodoWriteRenderer } from "../src/components/tool-renderers/todo-write-renderer";
import type { ClientToolCall } from "../src/components/tool-renderers/types";

afterEach(cleanup);

function makeCall(overrides: Partial<ClientToolCall> = {}): ClientToolCall {
  return {
    id: "tool-todo-1",
    name: "TodoWrite",
    param: "",
    sourceUuid: "uuid-1",
    input: {
      todos: [
        { content: "Update docs", status: "completed", activeForm: "Updating docs" },
        { content: "Fix login bug", status: "in_progress", activeForm: "Fixing login bug" },
        { content: "Write tests", status: "pending", activeForm: "Writing tests" },
      ],
    },
    ...overrides,
  };
}

function classNames(container: HTMLElement, selector: string): string[] {
  return [...container.querySelectorAll(selector)].map((node) => node.className);
}

describe("TodoWriteRenderer", () => {
  it("shows only the in-progress activeForm in the default view, never the checklist", () => {
    const { container } = render(<TodoWriteRenderer toolCall={makeCall()} />);

    expect({
      className: container.firstElementChild?.className,
      text: container.textContent,
      childCount: container.children.length,
    }).toStrictEqual({
      className: "text-body text-t6 italic",
      text: "Fixing login bug",
      childCount: 1,
    });
  });

  it("renders nothing in the default view when no item is in progress", () => {
    const { container } = render(
      <TodoWriteRenderer
        toolCall={makeCall({
          input: { todos: [{ content: "Write tests", status: "pending" }] },
        })}
      />,
    );

    expect(container.innerHTML).toStrictEqual("");
  });

  it("restores the full checklist under the verbose preset", () => {
    const { container } = render(<TodoWriteRenderer toolCall={makeCall()} verbose />);

    expect({
      list: classNames(container, ":scope > div"),
      markers: [...container.querySelectorAll("div > div > span:first-child")].map(
        (node) => node.textContent,
      ),
      rows: [...container.querySelectorAll(":scope > div > div")].map((node) => node.textContent),
      markerClass: classNames(container, ":scope > div > div > span:first-child")[0],
      contentClass: classNames(container, ":scope > div > div > span:last-child")[0],
    }).toStrictEqual({
      list: ["flex flex-col gap-g2 text-body text-secondary"],
      markers: ["[x]", "[-]", "[ ]"],
      rows: ["[x]Update docs", "[-]Fix login bug", "[ ]Write tests"],
      markerClass: "shrink-0 font-mono text-t6",
      contentClass: "min-w-0 break-words",
    });
  });

  it("forwards the result only when the call failed", () => {
    const failed = render(
      <TodoWriteRenderer
        toolCall={makeCall({ isError: true, result: "Error: Failed to write todos" })}
      />,
    );
    const succeeded = render(
      <TodoWriteRenderer
        toolCall={makeCall({ result: "Todos have been modified successfully" })}
      />,
    );

    expect({
      failed: failed.container.textContent?.includes("Error: Failed to write todos"),
      succeeded: succeeded.container.textContent?.includes("Todos have been modified successfully"),
    }).toStrictEqual({
      failed: true,
      succeeded: false,
    });
  });
});
