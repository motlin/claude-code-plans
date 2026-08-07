// @vitest-environment jsdom

import type { HighlighterCore } from "@shikijs/core";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const shikiMocks = vi.hoisted(() => {
  const state: {
    highlighter: HighlighterCore | null;
    loadedLanguages: string[];
    subscriber: (() => void) | null;
    version: number;
  } = {
    highlighter: null,
    loadedLanguages: [],
    subscriber: null,
    version: 0,
  };
  const codeToHtml = vi.fn(() => '<pre class="shiki"><code>highlighted</code></pre>');
  const highlighter = {
    getLoadedLanguages: () => state.loadedLanguages,
    codeToHtml,
  } as unknown as HighlighterCore;
  const getHighlighterSync = vi.fn(() => state.highlighter);
  const getHighlighterVersion = vi.fn(() => state.version);
  const requestLanguage = vi.fn(() => Promise.resolve());
  const subscribeHighlighter = vi.fn((subscriber: () => void) => {
    state.subscriber = subscriber;
    return () => {
      if (state.subscriber === subscriber) state.subscriber = null;
    };
  });

  return {
    codeToHtml,
    getHighlighterSync,
    getHighlighterVersion,
    highlighter,
    requestLanguage,
    state,
    subscribeHighlighter,
  };
});

vi.mock("../src/hooks/use-shiki", () => ({
  getHighlighterSync: shikiMocks.getHighlighterSync,
  getHighlighterVersion: shikiMocks.getHighlighterVersion,
  requestLanguage: shikiMocks.requestLanguage,
  subscribeHighlighter: shikiMocks.subscribeHighlighter,
}));

import { MarkdownInline, MarkdownView } from "../src/components/markdown-view";

beforeEach(() => {
  shikiMocks.state.highlighter = null;
  shikiMocks.state.loadedLanguages.length = 0;
  shikiMocks.state.subscriber = null;
  shikiMocks.state.version = 0;
  shikiMocks.codeToHtml.mockClear();
  shikiMocks.getHighlighterSync.mockClear();
  shikiMocks.getHighlighterVersion.mockClear();
  shikiMocks.requestLanguage.mockClear();
  shikiMocks.subscribeHighlighter.mockClear();
});

afterEach(cleanup);

describe("MarkdownView", () => {
  it("renders synchronously without a Suspense ancestor", () => {
    const { container } = render(<MarkdownView markdown="# Hi" />);

    expect(container.querySelector("article")?.innerHTML).toBe("<h1>Hi</h1>\n");
  });

  it("preserves typographer output", () => {
    const { container } = render(<MarkdownView markdown={'He said "hi" -- ok'} />);

    expect(container.querySelector("article")?.innerHTML).toBe("<p>He said “hi” – ok</p>\n");
  });

  it("requests an unloaded fence language", () => {
    shikiMocks.state.highlighter = shikiMocks.highlighter;

    render(<MarkdownView markdown={"```typescript\nconst alice = 100;\n```"} />);

    expect(shikiMocks.requestLanguage.mock.calls).toStrictEqual([["typescript"]]);
  });

  it("upgrades a plain fence when its grammar arrives", () => {
    const { container } = render(
      <MarkdownView markdown={"```typescript\nconst alice = 100;\n```"} />,
    );

    expect(container.querySelector("article")?.innerHTML).toBe(
      '<pre><code class="language-typescript">const alice = 100;\n</code></pre>\n',
    );

    shikiMocks.state.highlighter = shikiMocks.highlighter;
    shikiMocks.state.loadedLanguages.push("typescript");
    shikiMocks.state.version++;
    act(() => shikiMocks.state.subscriber?.());

    expect(container.querySelector("article")?.innerHTML).toBe(
      '<pre class="shiki"><code>highlighted</code></pre>\n',
    );
  });
});

describe("MarkdownInline", () => {
  it("renders synchronously without paragraph wrapping or a highlighter subscription", () => {
    const { container } = render(<MarkdownInline markdown="**a** b" />);

    expect({
      html: container.firstElementChild?.innerHTML,
      subscriptionCalls: shikiMocks.subscribeHighlighter.mock.calls,
      tagName: container.firstElementChild?.tagName,
    }).toStrictEqual({
      html: "<strong>a</strong> b",
      subscriptionCalls: [],
      tagName: "SPAN",
    });
  });
});
