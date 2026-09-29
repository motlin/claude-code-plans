// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { SearchResultCard } from "../src/routes/search";
import type { UnifiedSearchItem } from "../src/lib/api/search";

const NOW = Date.parse("2026-08-10T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60_000;

function makeItem(overrides: Partial<UnifiedSearchItem> = {}): UnifiedSearchItem {
  return {
    kind: "session",
    id: "sess-1",
    title: "Fix the login flow",
    titleMatches: [{ start: 8, end: 13 }],
    projectId: "proj-a",
    projectName: "Alpha",
    mtime: new Date(NOW - 3 * DAY_MS).toISOString(),
    ...overrides,
  };
}

function runs(element: Element): string[] {
  return [...element.querySelectorAll(".font-semibold.text-primary")].map(
    (run) => run.textContent ?? "",
  );
}

function part(element: Element, name: string): string | null {
  return element.querySelector(`[data-search-${name}]`)?.textContent ?? null;
}

describe("SearchResultCard", () => {
  it("renders the title as highlight runs, not <mark>", () => {
    const view = render(<SearchResultCard item={makeItem()} now={NOW} />);
    expect({
      title: part(view.container, "label"),
      runs: runs(view.container),
      marks: view.container.querySelectorAll("mark").length,
    }).toStrictEqual({ title: "Fix the login flow", runs: ["login"], marks: 0 });
  });

  it("renders a quoted snippet with its own runs beside the title", () => {
    const item = makeItem({
      titleMatches: [],
      snippet: { text: "adjusted the login redirect", matches: [{ start: 13, end: 18 }] },
    });
    const view = render(<SearchResultCard item={item} now={NOW} />);
    expect({ snippet: part(view.container, "snippet"), runs: runs(view.container) }).toStrictEqual({
      snippet: "“adjusted the login redirect”",
      runs: ["login"],
    });
  });

  it("omits an empty snippet", () => {
    const view = render(
      <SearchResultCard item={makeItem({ snippet: { text: "", matches: [] } })} now={NOW} />,
    );
    expect(part(view.container, "snippet")).toBeNull();
  });

  it("shows the muted project name and the relative bucket as meta", () => {
    const view = render(<SearchResultCard item={makeItem()} now={NOW} />);
    expect(part(view.container, "meta")).toBe("Alpha · Past week");
  });

  it("shows only the project name when the bucket is empty (over a year old)", () => {
    const item = makeItem({ mtime: new Date(NOW - 400 * DAY_MS).toISOString() });
    const view = render(<SearchResultCard item={item} now={NOW} />);
    expect(part(view.container, "meta")).toBe("Alpha");
  });

  it("marks the row with its kind", () => {
    const view = render(<SearchResultCard item={makeItem({ kind: "plan" })} now={NOW} />);
    expect(view.container.querySelector("[data-item-type]")?.getAttribute("data-item-type")).toBe(
      "plan",
    );
  });
});
