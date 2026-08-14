// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { BashRenderer } from "../src/components/tool-renderers/bash-renderer";
import type { ClientToolCall } from "../src/components/tool-renderers/types";

const NBSP = String.fromCharCode(160);

const highlighted = vi.hoisted(() => ({ tokens: null as unknown }));

vi.mock("../src/hooks/use-shiki", () => ({
  useHighlightedLines: () => highlighted.tokens,
}));

afterEach(() => {
  highlighted.tokens = null;
  cleanup();
});

const CALL: ClientToolCall = {
  id: "tool-bash-1",
  name: "Bash",
  input: { command: "git status" },
  param: "git status",
  result: "$ git status\nnothing to commit",
  sourceUuid: "uuid-1",
};

function promptLayout(container: HTMLElement) {
  const row = container.querySelector(".flex > span.select-none")?.parentElement;
  return {
    rowClass: row?.className,
    promptClass: row?.children[0]?.className,
    promptText: row?.children[0]?.textContent,
    commandClass: row?.children[1]?.className,
    commandText: row?.children[1]?.textContent,
  };
}

describe("BashRenderer command prompt", () => {
  it("renders the unhighlighted prompt as an unselectable gutter beside the command column", () => {
    const { container } = render(<BashRenderer toolCall={CALL} />);

    expect(promptLayout(container)).toStrictEqual({
      rowClass: "flex",
      promptClass: "select-none text-secondary",
      promptText: `$${NBSP}`,
      commandClass: "min-w-0 flex-1 whitespace-pre-wrap",
      commandText: "git status",
    });
  });

  it("renders the highlighted prompt as an unselectable gutter beside the command column", () => {
    highlighted.tokens = [
      [
        { content: "git ", color: "#aaa", offset: 0 },
        { content: "status", color: "#bbb", offset: 4 },
      ],
    ];

    const { container } = render(<BashRenderer toolCall={CALL} />);

    expect(promptLayout(container)).toStrictEqual({
      rowClass: "flex",
      promptClass: "select-none text-secondary",
      promptText: `$${NBSP}`,
      commandClass: "min-w-0 flex-1 whitespace-pre-wrap",
      commandText: "git status",
    });
  });

  it("copies the command and output without the shell prompt", () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    const { container } = render(<BashRenderer toolCall={CALL} />);
    container.querySelector<HTMLButtonElement>("button[aria-label='Copy']")?.click();

    expect(writeText.mock.calls).toStrictEqual([["git status\nnothing to commit"]]);
  });
});
