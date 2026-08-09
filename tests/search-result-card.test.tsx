// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { SearchResultCard } from "../src/routes/search";
import type { MessageSearchItem, SessionSearchItem } from "../src/lib/api/search";

function makeSessionResult(overrides: Partial<SessionSearchItem> = {}): SessionSearchItem {
  return {
    sessionId: "sess-1",
    title: "Fix the login flow",
    titleHtml: "Fix the login flow",
    firstPrompt: "Fix the login flow before release",
    summary: null,
    snippet: "",
    projectId: "proj-a",
    projectName: "Alpha",
    mtime: "2026-08-01T00:00:00.000Z",
    messageCount: 5,
    rank: -1,
    ...overrides,
  };
}

function makeMessageResult(overrides: Partial<MessageSearchItem> = {}): MessageSearchItem {
  return {
    sessionId: "sess-2",
    title: "Fix the login flow",
    snippet: "we adjusted the <mark>login</mark> redirect",
    projectId: "proj-a",
    projectName: "Alpha",
    mtime: "2026-08-01T00:00:00.000Z",
    messageCount: 5,
    rank: -1,
    ...overrides,
  };
}

describe("SearchResultCard", () => {
  it("does not render the snippet line when it equals the title", () => {
    const result = makeSessionResult({ snippet: "Fix the login flow" });
    const view = render(<SearchResultCard result={result} />);
    const occurrences = view.container.textContent?.split("Fix the login flow").length;
    expect(occurrences).toBe(2); // title only: exactly one occurrence
  });

  it("does not render the snippet line when it equals the title after unescaping", () => {
    const result = makeSessionResult({
      title: 'Fix the <a> & "b" login flow',
      titleHtml: "Fix the &lt;a&gt; &amp; &quot;b&quot; login flow",
      snippet: "Fix the &lt;a&gt; &amp; &quot;b&quot; login flow",
    });
    const view = render(<SearchResultCard result={result} />);
    const occurrences = view.container.textContent?.split('Fix the <a> & "b" login flow').length;
    expect(occurrences).toBe(2);
  });

  it("renders highlighted title marks", () => {
    const result = makeSessionResult({
      titleHtml: "Fix the <mark>login</mark> flow",
    });
    const view = render(<SearchResultCard result={result} />);
    const mark = view.container.querySelector("mark");
    expect(mark?.textContent).toBe("login");
  });

  it("renders a differentiated snippet with highlighting", () => {
    const result = makeSessionResult({
      snippet: "...before <mark>release</mark> next week",
    });
    const view = render(<SearchResultCard result={result} />);
    const mark = view.container.querySelector("mark");
    expect(mark?.textContent).toBe("release");
    expect(view.container.textContent).toContain("...before release next week");
  });

  it("renders message results without titleHtml using the plain title", () => {
    const view = render(<SearchResultCard result={makeMessageResult()} />);
    expect(view.container.textContent).toContain("Fix the login flow");
    expect(view.container.querySelector("mark")?.textContent).toBe("login");
  });
});
