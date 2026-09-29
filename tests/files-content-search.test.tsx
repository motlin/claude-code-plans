// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { FilesTree, FilesTreeColumn } from "../src/components/files/files-tree";
import { SettingsProvider } from "../src/components/settings-provider";
import type { FileSearchResult } from "../src/lib/api/search";
import {
  askAboutPrompt,
  groupContentSearchResults,
  matchesSmartCase,
  parseContentSearchQuery,
  parseMarkedSnippet,
  windowSnippet,
} from "../src/lib/files-content-search";
import { installLocalStorage } from "./fake-storage";

class FakeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

describe("parseContentSearchQuery", () => {
  it.each([
    ["", null],
    ["src/", null],
    ["needle", null],
    [" ?needle", null],
    ["?", ""],
    ["?  ", ""],
    ["?needle", "needle"],
    ["? two words ", "two words"],
  ])("%j → %j", (filter, expected) => {
    expect(parseContentSearchQuery(filter)).toBe(expected);
  });
});

describe("parseMarkedSnippet", () => {
  it("unescapes the server's HTML and finds the first highlighted range", () => {
    expect(
      parseMarkedSnippet(
        "if (a &lt; b &amp;&amp; <mark>needle</mark>) &quot;x&#39;s&quot; <mark>needle</mark>",
      ),
    ).toStrictEqual({
      text: `if (a < b && needle) "x's" needle`,
      match: { start: 13, end: 19 },
    });
  });

  it("returns no match when nothing is highlighted", () => {
    expect(parseMarkedSnippet("plain &gt; text")).toStrictEqual({
      text: "plain > text",
      match: null,
    });
  });
});

describe("windowSnippet", () => {
  it("keeps a short lead as is, with whitespace collapsed and trimmed", () => {
    const text = "    const   value =\tneedle;  ";
    expect(windowSnippet(text, { start: 20, end: 26 })).toStrictEqual({
      text: "const value = needle;",
      match: { start: 14, end: 20 },
    });
  });

  it("keeps a lead of exactly 26 characters", () => {
    const lead = "abcdefghijklmnopqrstuvwxy ";
    expect(windowSnippet(`${lead}needle`, { start: 26, end: 32 })).toStrictEqual({
      text: `${lead}needle`,
      match: { start: 26, end: 32 },
    });
  });

  it("cuts a long lead to at most 26 characters, snapped to a word start, behind an ellipsis", () => {
    const text = "aaaa bbbb cccc dddd eeee ffff gggg needle tail";
    expect(windowSnippet(text, { start: 35, end: 41 })).toStrictEqual({
      text: "…cccc dddd eeee ffff gggg needle tail",
      match: { start: 26, end: 32 },
    });
  });

  it("cuts exactly at 26 characters when the cut already falls on a word start", () => {
    const text = "aaaaaaa bbbb cccc dddd eeee fffff needle";
    expect(windowSnippet(text, { start: 34, end: 40 })).toStrictEqual({
      text: "…bbbb cccc dddd eeee fffff needle",
      match: { start: 27, end: 33 },
    });
  });

  it("cuts mid-word when the lead has no word boundary to snap to", () => {
    const text = `${"x".repeat(40)}needle`;
    expect(windowSnippet(text, { start: 40, end: 46 })).toStrictEqual({
      text: `…${"x".repeat(26)}needle`,
      match: { start: 27, end: 33 },
    });
  });

  it("returns the collapsed text when there is no match", () => {
    expect(windowSnippet("  a   b  ", null)).toStrictEqual({ text: "a b", match: null });
  });
});

describe("matchesSmartCase", () => {
  it.each([
    ["const Needle = 1", "needle", true],
    ["const Needle = 1", "Needle", true],
    ["const needle = 1", "Needle", false],
    ["const Needle = other", "Needle other", true],
  ])("%j with %j → %s", (text, query, expected) => {
    expect(matchesSmartCase(text, query)).toBe(expected);
  });
});

describe("askAboutPrompt", () => {
  it("fills the upstream template", () => {
    expect(askAboutPrompt("src/a.ts", 12, "const needle = 1;")).toBe(
      "In src/a.ts at line 12: `const needle = 1;` — explain what this does and where it’s used.",
    );
  });
});

function searchFile(
  path: string,
  matchCount: number,
  matches: Array<{ lineNumber: number; snippet: string }>,
) {
  return { path, matchCount, matches, mtime: "2026-09-01T00:00:00.000Z", rank: -1 };
}

const RESULT: FileSearchResult = {
  files: [
    searchFile("/repo/src/a.ts", 2, [
      { lineNumber: 3, snippet: "const <mark>needle</mark> = 1;" },
      { lineNumber: 9, snippet: "  return <mark>Needle</mark>;" },
    ]),
    searchFile("/repo/notes.md", 0, []),
    searchFile(
      "/repo/big.txt",
      7,
      [1, 2, 3, 4, 5, 6].map((lineNumber) => ({
        lineNumber,
        snippet: `line ${lineNumber} <mark>needle</mark>`,
      })),
    ),
  ],
  totalResults: 9,
  totalFiles: 3,
  isTruncated: false,
};

describe("groupContentSearchResults", () => {
  it("groups matches per file relative to the working directory and drops path-only hits", () => {
    expect(groupContentSearchResults(RESULT, "/repo", "needle")).toStrictEqual({
      groups: [
        {
          path: "/repo/src/a.ts",
          relPath: "src/a.ts",
          more: false,
          matches: [
            {
              line: 3,
              text: "const needle = 1;",
              snippet: { text: "const needle = 1;", match: { start: 6, end: 12 } },
            },
            {
              line: 9,
              text: "return Needle;",
              snippet: { text: "return Needle;", match: { start: 7, end: 13 } },
            },
          ],
        },
        {
          path: "/repo/big.txt",
          relPath: "big.txt",
          more: true,
          matches: [1, 2, 3, 4, 5].map((line) => ({
            line,
            text: `line ${line} needle`,
            snippet: { text: `line ${line} needle`, match: { start: 7, end: 13 } },
          })),
        },
      ],
      shownCount: 7,
      capped: false,
    });
  });

  it("applies smart case when the query has capitals", () => {
    const grouped = groupContentSearchResults(RESULT, "/repo/", "Needle");
    expect(
      grouped.groups.map((group) => ({
        relPath: group.relPath,
        lines: group.matches.map((match) => match.line),
        more: group.more,
      })),
    ).toStrictEqual([{ relPath: "src/a.ts", lines: [9], more: false }]);
  });

  it("reports a capped result only when the server left files out", () => {
    expect({
      filesLeftOut: groupContentSearchResults(
        { ...RESULT, isTruncated: true, totalFiles: 150 },
        "/repo",
        "needle",
      ).capped,
      matchesLeftOut: groupContentSearchResults({ ...RESULT, isTruncated: true }, "/repo", "needle")
        .capped,
    }).toStrictEqual({ filesLeftOut: true, matchesLeftOut: false });
  });
});

const SEARCH_RESPONSE: FileSearchResult = {
  files: [
    searchFile("/repo/src/a.ts", 1, [{ lineNumber: 3, snippet: "const <mark>needle</mark> = 1;" }]),
    searchFile("/repo/big.txt", 9, [{ lineNumber: 4, snippet: "line 4 <mark>needle</mark>" }]),
  ],
  totalResults: 10,
  totalFiles: 2,
  isTruncated: false,
};

let requests: string[];

function stubFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = new URL(input, "http://localhost");
      requests.push(`${url.pathname}?${url.searchParams.toString()}`);
      if (url.pathname === "/api/search/files") {
        return Response.json(
          url.searchParams.get("query") === "needle"
            ? SEARCH_RESPONSE
            : { files: [], totalResults: 0, totalFiles: 0, isTruncated: false },
        );
      }
      return Response.json({ kind: "listing", dir: "", entries: [], partial: false });
    }),
  );
}

function renderTree() {
  const onOpenFile = vi.fn();
  const onAttachContext = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <FilesTreeColumn>
          <FilesTree
            sessionId="content-session"
            cwd="/repo"
            onOpenFile={onOpenFile}
            onAttachContext={onAttachContext}
          />
        </FilesTreeColumn>
      </SettingsProvider>
    </QueryClientProvider>,
  );
  return { onOpenFile, onAttachContext };
}

function filterInput(): HTMLInputElement {
  return screen.getByRole("textbox", { name: "Filter files" }) as HTMLInputElement;
}

beforeEach(() => {
  installLocalStorage();
  requests = [];
  stubFetch();
  vi.stubGlobal("ResizeObserver", FakeObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("FilesTree content search", () => {
  it("advertises content search in the placeholder", () => {
    renderTree();
    expect(filterInput().placeholder).toBe("Filter files… (? for contents)");
  });

  it("prompts for a query after a bare ?", async () => {
    renderTree();
    fireEvent.change(filterInput(), { target: { value: "?" } });
    expect(await screen.findByText("Type after ? to search file contents")).toBeTruthy();
  });

  it("routes a ? query to the file content search scoped to the working directory", async () => {
    const { onOpenFile, onAttachContext } = renderTree();
    fireEvent.change(filterInput(), { target: { value: "?needle" } });
    await screen.findByText("a.ts");

    const groups = screen.getAllByRole("group").map((group) => ({
      file: group.getAttribute("aria-label"),
      rows: [...group.querySelectorAll("[data-content-match]")].map((row) => row.textContent),
      more: group.querySelector("[data-content-more]")?.textContent ?? null,
    }));

    fireEvent.keyDown(filterInput(), { key: "ArrowDown" });
    fireEvent.keyDown(document.activeElement as Element, { key: "Enter" });
    fireEvent.click(screen.getAllByRole("button", { name: "Ask about this" })[0]!);

    expect({
      contentRequests: requests.filter((request) => request.startsWith("/api/search/files")),
      treeRequestedQuestion: requests.some(
        (request) => !request.startsWith("/api/search/files") && request.includes("%3F"),
      ),
      groups,
      opens: onOpenFile.mock.calls,
      asks: onAttachContext.mock.calls,
    }).toStrictEqual({
      contentRequests: ["/api/search/files?query=needle&scopeRoot=%2Frepo"],
      treeRequestedQuestion: false,
      groups: [
        { file: "src/a.ts", rows: ["3const needle = 1;"], more: null },
        { file: "big.txt", rows: ["4line 4 needle"], more: "More matches in this file." },
      ],
      opens: [["src/a.ts", { pin: false, line: 3, findQuery: "needle" }]],
      asks: [
        [
          "In src/a.ts at line 3: `const needle = 1;` — explain what this does and where it’s used.",
        ],
      ],
    });
  });

  it("says when file contents have no matches", async () => {
    renderTree();
    fireEvent.change(filterInput(), { target: { value: "?nothing" } });
    expect(await screen.findByText("No matches in file contents")).toBeTruthy();
  });
});
