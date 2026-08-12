// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { KeyValueCard } from "../src/components/tool-renderers/shared";

vi.mock("../src/hooks/use-shiki", () => ({
  useHighlightedLines: () => null,
  getHighlighterSync: () => null,
  getHighlighterVersion: () => 0,
  subscribeHighlighter: () => () => {},
}));

function paramsContainer(container: HTMLElement): HTMLElement {
  const found = container.querySelector<HTMLElement>('[class*="gap-g2"]');
  if (!found) throw new Error("Missing params container");
  return found;
}

afterEach(cleanup);

describe("KeyValueCard params", () => {
  it("stacks each param as a break-words row of mono key and value spans", () => {
    const { container } = render(
      <KeyValueCard
        params={[
          { key: "pattern", value: "alice" },
          { key: "path", value: "src" },
        ]}
      />,
    );
    const params = paramsContainer(container);

    expect({
      containerClass: params.className,
      rows: [...params.children].map((row) => ({
        className: row.className,
        spans: [...row.children].map((span) => ({
          className: span.className,
          text: span.textContent,
        })),
      })),
    }).toStrictEqual({
      containerClass: "text-assistant-secondary flex flex-col gap-g2",
      rows: [
        {
          className: "break-words",
          spans: [
            { className: "text-code font-mono opacity-70", text: "pattern: " },
            { className: "text-code font-mono whitespace-pre-wrap break-all", text: "alice" },
          ],
        },
        {
          className: "break-words",
          spans: [
            { className: "text-code font-mono opacity-70", text: "path: " },
            { className: "text-code font-mono whitespace-pre-wrap break-all", text: "src" },
          ],
        },
      ],
    });
  });
});
