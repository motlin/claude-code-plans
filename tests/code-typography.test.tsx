// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { EditRenderer } from "../src/components/tool-renderers/edit-renderer";
import { ReadRenderer } from "../src/components/tool-renderers/read-renderer";
import { WriteRenderer } from "../src/components/tool-renderers/write-renderer";
import type { ClientToolCall } from "../src/components/tool-renderers/types";

const diffViewFontSizes = vi.hoisted(() => [] as number[]);

vi.mock("@git-diff-view/react", () => ({
  DiffModeEnum: { Unified: 4 },
  DiffView: ({ diffViewFontSize }: { diffViewFontSize: number }) => {
    diffViewFontSizes.push(diffViewFontSize);
    return <div data-testid="diff-view" />;
  },
}));

vi.mock("../src/lib/diff-highlighter", () => ({
  resolveDiffLanguage: () => "typescript",
  useShikiDiffHighlighter: () => undefined,
}));

vi.mock("../src/hooks/use-shiki", () => ({
  useHighlightedLines: () => null,
}));

function toolCall(name: string, input: Record<string, unknown>, result?: string): ClientToolCall {
  return {
    id: "tool-call-100",
    name,
    input,
    param: "",
    result,
    sourceUuid: "source-100",
  };
}

function customProperty(styles: string, name: string): string {
  const match = styles.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!match?.[1]) throw new Error(`Missing ${name}`);
  return match[1].trim();
}

afterEach(() => {
  cleanup();
  diffViewFontSizes.length = 0;
});

describe("code typography", () => {
  it("pins the upstream code font size and line height tokens", () => {
    const styles = readFileSync("src/styles/globals.css", "utf8");

    expect({
      fontSize: customProperty(styles, "--upstream-text-code"),
      lineHeight: customProperty(styles, "--upstream-leading-code"),
    }).toStrictEqual({
      fontSize: "13px",
      lineHeight: "20px",
    });
  });

  it("renders write and edit diffs with the code type token", () => {
    render(
      <WriteRenderer
        toolCall={toolCall("Write", {
          file_path: "/test/alice.ts",
          content: "const alice = 100;",
        })}
      />,
    );
    render(
      <EditRenderer
        toolCall={toolCall("Edit", {
          file_path: "/test/alice.ts",
          old_string: "const alice = 100;",
          new_string: "const alice = 200;",
        })}
      />,
    );

    expect({
      fontSizes: diffViewFontSizes,
      wrappers: screen
        .getAllByTestId("diff-view")
        .map((element) => element.parentElement?.className),
    }).toStrictEqual({
      fontSizes: [13, 13],
      wrappers: ["overflow-hidden text-code", "overflow-hidden text-code"],
    });
  });

  it("sizes read rows from the code line-height token and font-relative padding", () => {
    const { container } = render(
      <ReadRenderer
        toolCall={toolCall("Read", { file_path: "/test/alice.ts" }, "1→const alice = 100;")}
      />,
    );
    const gutterRow = container.querySelector("[data-gutter] > div");
    const contentRow = container.querySelector("[data-content] > div");

    expect({
      gutter: {
        className: gutterRow?.className,
        padding: (gutterRow as HTMLElement | null)?.style.padding,
      },
      content: {
        className: contentRow?.className,
        padding: (contentRow as HTMLElement | null)?.style.padding,
      },
    }).toStrictEqual({
      gutter: {
        className: "h-[var(--upstream-leading-code)] text-right",
        padding: "0px 0.6em 0px 1.2em",
      },
      content: {
        className: "h-[var(--upstream-leading-code)] whitespace-pre",
        padding: "0px 0.6em",
      },
    });
  });
});
