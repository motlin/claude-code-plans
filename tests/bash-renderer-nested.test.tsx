// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { BashRenderer } from "../src/components/tool-renderers/bash-renderer";
import type { ClientToolCall } from "../src/components/tool-renderers/types";

vi.mock("../src/hooks/use-shiki", () => ({
  useHighlightedLines: () => null,
}));

afterEach(cleanup);

const CALL: ClientToolCall = {
  id: "tool-bash-1",
  name: "Bash",
  input: { command: "git status" },
  param: "git status",
  result: "$ git status\nnothing to commit",
  sourceUuid: "uuid-1",
};

function classNames(container: HTMLElement, selector: string): string[] {
  return [...container.querySelectorAll(selector)].map((node) => node.className);
}

describe("BashRenderer nested body", () => {
  it("drops the card header and lays the body out as a flex-1 column beside the copy button", () => {
    const { container } = render(<BashRenderer toolCall={CALL} nested />);

    expect({
      header: classNames(container, ".px-p6"),
      body: classNames(container, ":scope > div:first-child"),
      childCount: container.children.length,
      copyButton: container.querySelector("button[aria-label='Copy']") !== null,
      command: container.textContent?.includes("$ git status"),
      output: container.textContent?.includes("nothing to commit"),
    }).toStrictEqual({
      header: [],
      body: ["flex-1 min-w-0 flex flex-col gap-g8 text-code font-mono"],
      childCount: 2,
      copyButton: true,
      command: true,
      output: true,
    });
  });

  it("keeps the card header and padded body when not nested", () => {
    const { container } = render(<BashRenderer toolCall={CALL} />);

    expect({
      header: classNames(container, ".px-p6.py-p5"),
      body: classNames(container, ".gap-g8"),
      copyButton: container.querySelector("button[aria-label='Copy']") !== null,
    }).toStrictEqual({
      header: ["flex items-center px-p6 py-p5"],
      body: ["flex flex-col gap-g8 px-p6 pb-p8 text-code font-mono"],
      copyButton: true,
    });
  });
});
