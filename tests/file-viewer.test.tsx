// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { FileViewer, fileViewerLanguage, parseFileLineHash } from "../src/components/file-viewer";

const useHighlightedLines = vi.hoisted(() =>
  vi.fn<(code: string, language: string | null) => null>(() => null),
);

vi.mock("../src/hooks/use-shiki", () => ({ useHighlightedLines }));

const scrollIntoView = vi.fn();

function renderViewer(content: string, path = "/test/alice.unknown") {
  return render(<FileViewer file={{ content, path }} />);
}

function highlightedLineIds(): string[] {
  return [...document.querySelectorAll('[data-highlighted="true"]')].map((element) => element.id);
}

beforeEach(() => {
  window.history.replaceState(null, "", "/file/fabricated-token");
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView,
  });
  scrollIntoView.mockReset();
  useHighlightedLines.mockClear();
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

describe("read-only file viewer", () => {
  it("scrolls to and highlights line 142 from the initial hash", () => {
    window.history.replaceState(null, "", "/file/fabricated-token#L142");
    renderViewer(Array.from({ length: 150 }, (_, index) => `line ${index + 1}`).join("\n"));

    expect({
      currentGutter: screen
        .getByRole("cell", { name: "Go to line 142" })
        .getAttribute("aria-current"),
      highlightedLineIds: highlightedLineIds(),
      lineText: document.querySelector("#L142")?.textContent,
      scrollCalls: scrollIntoView.mock.calls,
    }).toStrictEqual({
      currentGutter: "location",
      highlightedLineIds: ["L142"],
      lineText: "142line 142",
      scrollCalls: [[{ block: "center" }]],
    });
  });

  it("updates the hash from an accessible gutter and preserves source whitespace safely", () => {
    const { container } = renderViewer("<img src=x onerror=alert(1)>\n\tconst alice = 100;");

    fireEvent.click(screen.getByRole("cell", { name: "Go to line 2" }));

    expect({
      hash: window.location.hash,
      highlightedLineIds: highlightedLineIds(),
      renderedImages: container.querySelectorAll("img").length,
      secondLineText: document.querySelector("#L2 code")?.textContent,
      scrollCalls: scrollIntoView.mock.calls,
    }).toStrictEqual({
      hash: "#L2",
      highlightedLineIds: ["L2"],
      renderedImages: 0,
      secondLineText: "\tconst alice = 100;",
      scrollCalls: [[{ block: "center" }]],
    });
  });

  it("ignores malformed and nonexistent line hashes without errors", () => {
    window.history.replaceState(null, "", "/file/fabricated-token#L0");
    renderViewer("first\nsecond");

    window.history.pushState(null, "", "#L100");
    fireEvent(window, new HashChangeEvent("hashchange"));
    window.history.pushState(null, "", "#line-1");
    fireEvent(window, new HashChangeEvent("hashchange"));

    expect({
      highlightedLineIds: highlightedLineIds(),
      parsedHashes: ["#L1", "#L01", "#L0", "#L100", "#line-1"].map(parseFileLineHash),
      scrollCalls: scrollIntoView.mock.calls,
    }).toStrictEqual({
      highlightedLineIds: [],
      parsedHashes: [1, null, null, 100, null],
      scrollCalls: [],
    });
  });

  it("tracks repeated hash navigation and reactivates a gutter already selected", () => {
    renderViewer("first\nsecond\nthird");

    window.history.pushState(null, "", "#L2");
    fireEvent(window, new HashChangeEvent("hashchange"));
    window.history.pushState(null, "", "#L1");
    fireEvent(window, new HashChangeEvent("hashchange"));
    fireEvent.click(screen.getByRole("cell", { name: "Go to line 1" }));

    expect({
      currentGutters: screen
        .getAllByRole("cell", { name: /Go to line/ })
        .map((element) => element.getAttribute("aria-current")),
      hash: window.location.hash,
      highlightedLineIds: highlightedLineIds(),
      scrollCalls: scrollIntoView.mock.calls,
    }).toStrictEqual({
      currentGutters: ["location", null, null],
      hash: "#L1",
      highlightedLineIds: ["L1"],
      scrollCalls: [[{ block: "center" }], [{ block: "center" }], [{ block: "center" }]],
    });
  });

  it("uses detected Shiki languages and falls back to plain lines for unknown extensions", () => {
    const view = renderViewer("const alice = 100;", "/test/alice.unknown");
    view.rerender(<FileViewer file={{ content: "const alice = 100;", path: "/test/alice.ts" }} />);

    expect({
      detectedLanguages: [
        fileViewerLanguage("/test/alice.unknown"),
        fileViewerLanguage("/test/alice.ts"),
      ],
      highlighterCalls: useHighlightedLines.mock.calls.map(([content, language]) => ({
        content,
        language,
      })),
    }).toStrictEqual({
      detectedLanguages: [null, "typescript"],
      highlighterCalls: [
        { content: "const alice = 100;", language: null },
        { content: "const alice = 100;", language: "typescript" },
      ],
    });
  });
});
