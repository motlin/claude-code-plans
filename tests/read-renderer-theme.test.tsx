// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ReadRenderer } from "../src/components/tool-renderers/read-renderer";
import type { ClientToolCall } from "../src/components/tool-renderers/types";

const useHighlightedLines = vi.hoisted(() => vi.fn(() => null));

vi.mock("../src/hooks/use-shiki", () => ({ useHighlightedLines }));

const readToolCall: ClientToolCall = {
  id: "tool-call-read-theme",
  name: "Read",
  input: { file_path: "/test/alice.ts" },
  param: "/test/alice.ts",
  result: "1→const alice = 100;",
  sourceUuid: "source-read-theme",
};

beforeEach(() => {
  useHighlightedLines.mockClear();
});

afterEach(cleanup);

describe("Read body follows the active theme", () => {
  it("paints the code slab from theme tokens instead of hardcoded GitHub-dark colors", () => {
    const { container } = render(<ReadRenderer toolCall={readToolCall} />);

    const pre = container.querySelector("pre");
    const gutterRow = container.querySelector<HTMLElement>("[data-gutter] > div");
    const contentRow = container.querySelector<HTMLElement>("[data-content] > div");

    expect({
      preClassName: pre?.className,
      preBackgroundColor: pre?.style.backgroundColor,
      preColor: pre?.style.color,
      gutterClassName: gutterRow?.className,
      gutterColor: gutterRow?.style.color,
      contentColor: contentRow?.style.color,
    }).toStrictEqual({
      preClassName:
        "m-0 max-h-[400px] overflow-y-auto overflow-x-auto font-mono text-code leading-code text-primary",
      preBackgroundColor: "",
      preColor: "",
      gutterClassName: "h-[var(--upstream-leading-code)] text-right text-secondary",
      gutterColor: "",
      contentColor: "",
    });
  });

  it("highlights tokens with the resolved theme rather than forcing dark", () => {
    render(<ReadRenderer toolCall={readToolCall} />);

    expect(useHighlightedLines.mock.calls).toStrictEqual([["const alice = 100;", "typescript"]]);
  });
});
