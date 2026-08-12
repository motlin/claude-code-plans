// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { ChromeDevtoolsRenderer } from "../src/components/tool-renderers/chrome-devtools-renderer";
import { ClaudeInChromeRenderer } from "../src/components/tool-renderers/claude-in-chrome-renderer";
import { GithubRenderer } from "../src/components/tool-renderers/github-renderer";
import { PlaywrightRenderer } from "../src/components/tool-renderers/playwright-renderer";
import type { ClientToolCall } from "../src/components/tool-renderers/types";

function toolCall(
  name: string,
  input: Record<string, unknown>,
  result: string,
  isError?: boolean,
): ClientToolCall {
  const call: ClientToolCall = {
    id: "tool-call-1",
    name,
    input,
    param: "",
    result,
    sourceUuid: "source-1",
  };
  if (isError !== undefined) call.isError = isError;
  return call;
}

const HOVER_REVEAL_CLASS =
  "opacity-0 group-hover/body:opacity-100 focus-within:opacity-100 [transition:opacity_150ms_cubic-bezier(0.215,0.61,0.355,1)] motion-reduce:transition-none";

const CASES = [
  {
    label: "chrome-devtools",
    element: (
      <ChromeDevtoolsRenderer
        toolCall={toolCall(
          "mcp__plugin_chrome-devtools-mcp_chrome-devtools__list_console_messages",
          {},
          "msgid=1 [log] Hello world",
        )}
      />
    ),
    result: "msgid=1 [log] Hello world",
  },
  {
    label: "claude-in-chrome",
    element: (
      <ClaudeInChromeRenderer
        toolCall={toolCall("mcp__claude-in-chrome__tabs_context_mcp", {}, "tab 1\ntab 2")}
      />
    ),
    result: "tab 1\ntab 2",
  },
  {
    label: "github",
    element: (
      <GithubRenderer
        toolCall={toolCall("mcp__github__get_me", {}, "some plain github response text")}
      />
    ),
    result: "some plain github response text",
  },
  {
    label: "playwright",
    element: (
      <PlaywrightRenderer
        toolCall={toolCall(
          "mcp__plugin_playwright_playwright__browser_console_messages",
          {},
          "[LOG] hello",
        )}
      />
    ),
    result: "[LOG] hello",
  },
];

afterEach(cleanup);

describe("custom MCP renderers expose the shared copy button", () => {
  for (const { label, element, result } of CASES) {
    it(`copies the ${label} result text on click`, () => {
      const writeText = vi.fn();
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText },
      });

      render(element);
      fireEvent.click(screen.getByLabelText("Copy"));

      expect(writeText.mock.calls).toStrictEqual([[result]]);
    });

    it(`reveals the ${label} copy button on body hover only`, () => {
      render(element);

      expect(screen.getByLabelText("Copy").parentElement?.className).toBe(HOVER_REVEAL_CLASS);
    });
  }

  it("keeps the copy button outside the recolored body of a failed call", () => {
    render(
      <PlaywrightRenderer
        toolCall={toolCall(
          "mcp__plugin_playwright_playwright__browser_click",
          { element: "Submit" },
          "Element not found",
          true,
        )}
      />,
    );

    const copyWrapper = screen.getByLabelText("Copy").parentElement;

    expect(copyWrapper?.closest(".text-extended-pink")).toBe(null);
  });
});
