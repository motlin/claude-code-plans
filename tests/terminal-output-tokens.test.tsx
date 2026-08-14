// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { TerminalOutput } from "../src/components/tool-renderers/shared";

afterEach(cleanup);

const BODY_CLASS = "max-h-[400px] overflow-y-auto whitespace-pre-wrap break-all";

function layout(container: HTMLElement) {
  const root = container.firstElementChild as HTMLElement;
  const pre = container.querySelector("pre") as HTMLElement;
  const exitCode = root.firstElementChild === pre ? null : (root.firstElementChild as HTMLElement);
  return {
    rootClass: root.className,
    exitCodeClass: exitCode?.className ?? null,
    exitCodeText: exitCode?.textContent ?? null,
    preClass: pre.className,
    preText: pre.textContent,
  };
}

describe("TerminalOutput", () => {
  it("renders a failing exit code as inline pink text beside a pink Bash-style body", () => {
    const { container } = render(<TerminalOutput content={"Exit code 1\nboom"} />);

    expect(layout(container)).toStrictEqual({
      rootClass: "text-code font-mono",
      exitCodeClass: "text-extended-pink",
      exitCodeText: "Exit code 1",
      preClass: `${BODY_CLASS} text-extended-pink`,
      preText: "boom",
    });
  });

  it("renders output without an exit code as a secondary-ink Bash-style body", () => {
    const { container } = render(<TerminalOutput content={"Compiled 42 modules"} />);

    expect(layout(container)).toStrictEqual({
      rootClass: "text-code font-mono",
      exitCodeClass: null,
      exitCodeText: null,
      preClass: `${BODY_CLASS} text-secondary`,
      preText: "Compiled 42 modules",
    });
  });

  it("keeps a zero exit code in secondary ink because it is not a failure", () => {
    const { container } = render(<TerminalOutput content={"Exit code 0\nall good"} />);

    expect(layout(container)).toStrictEqual({
      rootClass: "text-code font-mono",
      exitCodeClass: "text-secondary",
      exitCodeText: "Exit code 0",
      preClass: `${BODY_CLASS} text-secondary`,
      preText: "all good",
    });
  });

  it("draws no exit-code pill and no filled code slab", () => {
    const { container } = render(<TerminalOutput content={"Exit code 127\ncommand not found"} />);
    const html = container.innerHTML;

    expect(
      [
        "bg-danger-900",
        "text-danger-000",
        "bg-surface-0",
        "text-primary",
        "text-xs",
        "font-bold",
        "rounded",
      ].filter((token) => html.includes(token)),
    ).toStrictEqual([]);
  });
});
