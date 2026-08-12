// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { GlobRenderer } from "../src/components/tool-renderers/glob-renderer";
import { GrepRenderer } from "../src/components/tool-renderers/grep-renderer";
import { ReadRenderer } from "../src/components/tool-renderers/read-renderer";
import { ErrorBorder, KeyValueCard } from "../src/components/tool-renderers/shared";
import type { ClientToolCall } from "../src/components/tool-renderers/types";

vi.mock("../src/hooks/use-shiki", () => ({
  useHighlightedLines: () => null,
  getHighlighterSync: () => null,
  getHighlighterVersion: () => 0,
  subscribeHighlighter: () => () => {},
}));

/** Upstream paints failed tool bodies pink instead of drawing a danger rail. */
const PINK = "text-extended-pink";
const CAP = "max-h-[400px] overflow-y-auto";

function failedCall(name: string, input: Record<string, unknown>, result: string): ClientToolCall {
  return {
    id: "tool-call-err",
    name,
    input,
    param: "",
    result,
    isError: true,
    sourceUuid: "source-err",
  };
}

function railCount(container: HTMLElement): number {
  return container.querySelectorAll('[class*="border-l-2"]').length;
}

function firstCapped(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[class*="max-h-["]');
}

afterEach(cleanup);

describe("failed tool bodies", () => {
  it("recolors the body instead of drawing a danger rail", () => {
    const { container } = render(
      <ErrorBorder isError>
        <span data-testid="body">boom</span>
      </ErrorBorder>,
    );
    const wrapper = container.firstElementChild;

    expect({
      tag: wrapper?.tagName,
      className: wrapper?.className,
      keepsChild: wrapper?.querySelector("[data-testid='body']") !== null,
    }).toStrictEqual({
      tag: "DIV",
      className: PINK,
      keepsChild: true,
    });
  });

  it("leaves a successful body untouched", () => {
    const { container } = render(
      <ErrorBorder isError={false}>
        <span data-testid="body">ok</span>
      </ErrorBorder>,
    );

    expect(container.innerHTML).toBe('<span data-testid="body">ok</span>');
  });

  it("puts the KeyValueCard error message above the params in pink", () => {
    const { container } = render(
      <KeyValueCard
        isError
        params={[{ key: "pattern", value: "alice" }]}
        result="rg: unrecognized flag"
      />,
    );
    const column = container.querySelector<HTMLElement>('[class*="flex-1"]');
    const scroller = firstCapped(container);

    expect({
      columnClass: column?.className,
      children: [...(scroller?.children ?? [])].map((child) => ({
        className: child.className,
        text: child.textContent,
      })),
      rails: railCount(container),
    }).toStrictEqual({
      columnClass: "flex-1 min-w-0 flex flex-col gap-g4 text-body whitespace-pre-wrap break-words",
      children: [
        { className: PINK, text: "rg: unrecognized flag" },
        {
          className: "text-assistant-secondary flex flex-col gap-g2",
          text: "pattern: alice",
        },
      ],
      rails: 0,
    });
  });

  it("keeps the successful KeyValueCard column secondary with the result below the params", () => {
    const { container } = render(
      <KeyValueCard params={[{ key: "pattern", value: "alice" }]} result="alice.ts" />,
    );
    const column = container.querySelector<HTMLElement>('[class*="flex-1"]');
    const scroller = firstCapped(container);

    expect({
      columnClass: column?.className,
      texts: [...(scroller?.children ?? [])].map((child) => child.textContent),
    }).toStrictEqual({
      columnClass:
        "flex-1 min-w-0 flex flex-col gap-g4 text-body text-assistant-secondary whitespace-pre-wrap break-words",
      texts: ["pattern: alice", "alice.ts"],
    });
  });

  it("renders the failed Grep message in pink above its params", () => {
    const { container } = render(
      <GrepRenderer toolCall={failedCall("Grep", { pattern: "alice" }, "rg exited with code 2")} />,
    );
    const scroller = firstCapped(container);

    expect({
      first: {
        className: scroller?.firstElementChild?.className,
        text: scroller?.firstElementChild?.textContent,
      },
      rails: railCount(container),
    }).toStrictEqual({
      first: { className: PINK, text: "rg exited with code 2" },
      rails: 0,
    });
  });

  it("renders the failed Glob message in pink above its params", () => {
    const { container } = render(
      <GlobRenderer toolCall={failedCall("Glob", { pattern: "**/*.ts" }, "EACCES: denied")} />,
    );
    const scroller = firstCapped(container);

    expect({
      first: {
        className: scroller?.firstElementChild?.className,
        text: scroller?.firstElementChild?.textContent,
      },
      rails: railCount(container),
    }).toStrictEqual({
      first: { className: PINK, text: "EACCES: denied" },
      rails: 0,
    });
  });

  it("swaps the Read code card for a plain pink body when the read failed", () => {
    const { container } = render(
      <ReadRenderer
        toolCall={failedCall("Read", { file_path: "/test/alice.ts" }, "File does not exist.")}
      />,
    );
    const body = firstCapped(container);

    expect({
      bodyClass: body?.className,
      text: body?.textContent,
      gutters: container.querySelectorAll("[data-gutter]").length,
      rails: railCount(container),
    }).toStrictEqual({
      bodyClass: `${CAP} text-code font-mono whitespace-pre-wrap break-all ${PINK}`,
      text: "File does not exist.",
      gutters: 0,
      rails: 0,
    });
  });
});
