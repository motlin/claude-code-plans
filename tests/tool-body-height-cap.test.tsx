// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { BashRenderer } from "../src/components/tool-renderers/bash-renderer";
import { Context7Renderer } from "../src/components/tool-renderers/context7-renderer";
import { EditRenderer } from "../src/components/tool-renderers/edit-renderer";
import { KeyValueCard } from "../src/components/tool-renderers/shared";
import { ReadRenderer } from "../src/components/tool-renderers/read-renderer";
import { WriteRenderer } from "../src/components/tool-renderers/write-renderer";
import type { ClientToolCall } from "../src/components/tool-renderers/types";

vi.mock("@git-diff-view/react", () => ({
  DiffModeEnum: { Unified: 4 },
  DiffView: () => <div data-testid="diff-view" />,
}));

vi.mock("../src/lib/diff-highlighter", () => ({
  resolveDiffLanguage: () => "typescript",
  useShikiDiffHighlighter: () => undefined,
}));

vi.mock("../src/hooks/use-shiki", () => ({
  useHighlightedLines: () => null,
  getHighlighterSync: () => null,
  getHighlighterVersion: () => 0,
  subscribeHighlighter: () => () => {},
}));

/** Upstream caps every expanded tool body at 400px with an inner scroller. */
const CAP = "max-h-[400px] overflow-y-auto";

function toolCall(name: string, input: Record<string, unknown>, result?: string): ClientToolCall {
  return {
    id: "tool-call-400",
    name,
    input,
    param: "",
    result,
    sourceUuid: "source-400",
  };
}

function cappedElements(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[class*="max-h-["]')];
}

function cappedClassNames(container: HTMLElement): string[] {
  return cappedElements(container).map((element) => element.className);
}

afterEach(cleanup);

describe("expanded tool bodies cap at 400px", () => {
  it("wraps KeyValueCard content in one scroller, leaving the copy button outside it", () => {
    const { container } = render(
      <KeyValueCard params={[{ key: "pattern", value: "alice" }]} result="one\ntwo">
        <div data-testid="extra-child" />
      </KeyValueCard>,
    );

    const scrollers = cappedElements(container);
    const scroller = scrollers[0];
    const column = scroller?.parentElement;

    expect({
      scrollerCount: scrollers.length,
      scrollerClass: scroller?.className,
      columnClass: column?.className,
      holdsParams: scroller?.textContent?.includes("pattern: alice") ?? false,
      holdsResult: scroller?.textContent?.includes("one\\ntwo") ?? false,
      holdsChildren: scroller?.querySelector("[data-testid='extra-child']") !== null,
      copyButtonInsideScroller: scroller?.querySelector("button[aria-label='Copy']") !== null,
      copyButtonInsideCard: container.querySelector("button[aria-label='Copy']") !== null,
    }).toStrictEqual({
      scrollerCount: 1,
      scrollerClass: `${CAP} flex flex-col gap-g4`,
      columnClass:
        "flex-1 min-w-0 flex flex-col gap-g4 text-body text-assistant-secondary whitespace-pre-wrap break-words",
      holdsParams: true,
      holdsResult: true,
      holdsChildren: true,
      copyButtonInsideScroller: false,
      copyButtonInsideCard: true,
    });
  });

  it("caps Bash stdout but not the command line", () => {
    const { container } = render(
      <BashRenderer toolCall={toolCall("Bash", { command: "ls -la" }, "$ ls -la\nalice.ts")} />,
    );

    const scrollers = cappedElements(container);

    expect({
      classNames: cappedClassNames(container),
      capsOutput: scrollers[0]?.textContent,
    }).toStrictEqual({
      classNames: [`${CAP} whitespace-pre-wrap break-all text-assistant-secondary`],
      capsOutput: "alice.ts",
    });
  });

  it("caps failed Bash stdout in the error color", () => {
    const { container } = render(
      <BashRenderer
        toolCall={{
          ...toolCall("Bash", { command: "ls -la" }, "$ ls -la\nboom"),
          isError: true,
        }}
      />,
    );

    expect(cappedClassNames(container)).toStrictEqual([
      `${CAP} whitespace-pre-wrap break-all text-extended-pink`,
    ]);
  });

  it("caps the Read body without hiding lines behind an expand button", () => {
    const { container } = render(
      <ReadRenderer
        toolCall={toolCall(
          "Read",
          { file_path: "/test/alice.ts" },
          Array.from({ length: 60 }, (_, index) => `${index + 1}→const alice = ${index};`).join(
            "\n",
          ),
        )}
      />,
    );

    expect({
      classNames: cappedClassNames(container),
      renderedLines: container.querySelectorAll("[data-content] > div").length,
      expandButtons: container.querySelectorAll("button").length,
    }).toStrictEqual({
      classNames: [`m-0 ${CAP} overflow-x-auto font-mono text-code leading-code`],
      renderedLines: 60,
      expandButtons: 1,
    });
  });

  it("caps the Write diff body", () => {
    const { container } = render(
      <WriteRenderer
        toolCall={toolCall("Write", { file_path: "/test/alice.ts", content: "const alice = 1;" })}
      />,
    );

    expect(cappedClassNames(container)).toStrictEqual([`${CAP} text-code`]);
  });

  it("caps the Write error body when the write failed", () => {
    const { container } = render(
      <WriteRenderer
        toolCall={{
          ...toolCall("Write", { file_path: "/test/alice.ts" }, "EACCES: permission denied"),
          isError: true,
        }}
      />,
    );

    expect(cappedClassNames(container)).toStrictEqual([
      `${CAP} text-code font-mono whitespace-pre-wrap break-all text-extended-pink`,
    ]);
  });

  it("caps the Edit diff body", () => {
    const { container } = render(
      <EditRenderer
        toolCall={toolCall("Edit", {
          file_path: "/test/alice.ts",
          old_string: "const alice = 1;",
          new_string: "const alice = 2;",
        })}
      />,
    );

    expect(cappedClassNames(container)).toStrictEqual([`${CAP} text-code`]);
  });

  it("caps the Edit error body when the edit failed", () => {
    const { container } = render(
      <EditRenderer
        toolCall={{
          ...toolCall("Edit", { file_path: "/test/alice.ts" }, "String to replace not found"),
          isError: true,
        }}
      />,
    );

    expect(cappedClassNames(container)).toStrictEqual([
      `${CAP} text-code font-mono whitespace-pre-wrap break-all text-extended-pink`,
    ]);
  });

  it("lets the Context7 markdown result ride the KeyValueCard scroller", () => {
    const { container } = render(
      <Context7Renderer
        toolCall={toolCall(
          "mcp__plugin_context7_context7__query-docs",
          { libraryName: "drizzle" },
          "# Drizzle\n\n- one\n- two",
        )}
      />,
    );

    expect(cappedClassNames(container)).toStrictEqual([`${CAP} flex flex-col gap-g4`]);
  });
});
