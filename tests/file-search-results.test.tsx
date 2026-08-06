// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  FileSearchResults,
  fileSearchViewerNavigation,
  fileSearchViewerTarget,
} from "../src/components/file-search-results";
import { decodeFilePath } from "../src/lib/api/file";
import { fileSearchRootsResponse } from "../src/routes/api/search.file-roots";
import { validateSearchParameters } from "../src/routes/search";

const FIRST_ROOT = "/tmp/test/allowed";
const SECOND_ROOT = "/tmp/test/second-root";
const FIRST_PATH = `${FIRST_ROOT}/alice-folder/needle-notes.ts`;
const SECOND_PATH = `${FIRST_ROOT}/bob.ts`;

function searchResult(paths: string[] = [FIRST_PATH, SECOND_PATH]) {
  return {
    files: paths.map((path, fileIndex) => ({
      path,
      matchCount: fileIndex === 0 ? 60 : 1,
      matches: Array.from({ length: fileIndex === 0 ? 50 : 1 }, (_, matchIndex) => ({
        lineNumber: (fileIndex + 1) * 100 + matchIndex,
        snippet:
          matchIndex === 0
            ? "&lt;img src=x onerror=alert(1)&gt; <mark>needle</mark>"
            : `line ${matchIndex + 1} <mark>needle</mark>`,
      })),
      mtime: "2000-01-01T00:00:00.000Z",
      rank: fileIndex,
    })),
    totalResults: paths.length === 0 ? 0 : 61,
    totalFiles: paths.length,
    isTruncated: paths.length > 0,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function queryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderSearch(properties: Partial<ComponentProps<typeof FileSearchResults>> = {}) {
  const onClose = vi.fn();
  const onOpen = vi.fn();
  const onQueryChange = vi.fn();
  const client = queryClient();
  const view = render(
    <QueryClientProvider client={client}>
      <FileSearchResults
        initialQuery="needle"
        onClose={onClose}
        onOpen={onOpen}
        onQueryChange={onQueryChange}
        {...properties}
      />
    </QueryClientProvider>,
  );
  return { client, onClose, onOpen, onQueryChange, view };
}

const scrollIntoView = vi.fn();

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView,
  });
  scrollIntoView.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

describe("file search results", () => {
  it("moves card focus with arrows, returns to the input above the first card, and opens with Enter", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        requestUrl(input).endsWith("/api/search/file-roots")
          ? jsonResponse({ roots: [FIRST_ROOT] })
          : jsonResponse(searchResult()),
      ),
    );
    const { onOpen } = renderSearch();
    const input = screen.getByRole("searchbox", { name: "Search file contents" });
    const firstCard = await screen.findByRole("button", {
      name: `Open ${FIRST_PATH} at line 100`,
    });
    const secondCard = screen.getByRole("button", { name: `Open ${SECOND_PATH} at line 200` });

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(firstCard, { key: "ArrowDown" });
    fireEvent.keyDown(secondCard, { key: "ArrowUp" });
    fireEvent.keyDown(firstCard, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(firstCard, { key: "Enter" });

    expect({
      activeElementAfterEnter: document.activeElement?.getAttribute("aria-label"),
      openCalls: onOpen.mock.calls,
      scrollCalls: scrollIntoView.mock.calls,
    }).toStrictEqual({
      activeElementAfterEnter: `Open ${FIRST_PATH} at line 100`,
      openCalls: [[FIRST_PATH, 100]],
      scrollCalls: [
        [{ block: "nearest" }],
        [{ block: "nearest" }],
        [{ block: "nearest" }],
        [{ block: "nearest" }],
      ],
    });
  });

  it("uses the clicked snippet line and caps the expander label at returned server matches", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        requestUrl(input).endsWith("/api/search/file-roots")
          ? jsonResponse({ roots: [FIRST_ROOT] })
          : jsonResponse(searchResult([FIRST_PATH])),
      ),
    );
    const { onOpen } = renderSearch();
    const expand = await screen.findByRole("button", { name: "+45 more in this file" });

    fireEvent.click(expand);
    const line149 = document.querySelector('[data-line-number="149"]');
    if (!line149) throw new Error("Expected the fabricated line 149 result");
    fireEvent.click(line149);

    expect({
      expandedLabel: screen.getByRole("button", { name: "Show fewer" }).textContent,
      lineNumber: line149.getAttribute("data-line-number"),
      openCalls: onOpen.mock.calls,
    }).toStrictEqual({
      expandedLabel: "Show fewer",
      lineNumber: "149",
      openCalls: [[FIRST_PATH, 149]],
    });
  });

  it("renders escaped snippets and highlighted directory and basename labels", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        requestUrl(input).endsWith("/api/search/file-roots")
          ? jsonResponse({ roots: [FIRST_ROOT] })
          : jsonResponse(searchResult([FIRST_PATH])),
      ),
    );
    renderSearch({ initialQuery: "alice needle" });
    const card = await screen.findByRole("button", { name: `Open ${FIRST_PATH} at line 100` });

    expect({
      imageCount: card.querySelectorAll("img").length,
      markedText: [...card.querySelectorAll("mark")].map((mark) => mark.textContent),
      nestedButtonCount: card.querySelectorAll("button").length,
      snippetText: within(card).getByText(/<img src=x onerror=alert\(1\)>/).textContent,
    }).toStrictEqual({
      imageCount: 0,
      markedText: ["alice", "needle", "needle", "needle", "needle", "needle", "needle"],
      nestedButtonCount: 0,
      snippetText: "<img src=x onerror=alert(1)> needle",
    });
  });

  it("deselects on the first Escape and closes on the second Escape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        requestUrl(input).endsWith("/api/search/file-roots")
          ? jsonResponse({ roots: [FIRST_ROOT] })
          : jsonResponse(searchResult([FIRST_PATH])),
      ),
    );
    const { onClose } = renderSearch();
    const input = screen.getByRole("searchbox", { name: "Search file contents" });
    const card = await screen.findByRole("button", { name: `Open ${FIRST_PATH} at line 100` });

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(card, { key: "Escape" });
    const afterFirstEscape = document.activeElement?.getAttribute("aria-label");
    fireEvent.keyDown(input, { key: "Escape" });

    expect({ afterFirstEscape, closeCalls: onClose.mock.calls }).toStrictEqual({
      afterFirstEscape: "Search file contents",
      closeCalls: [[]],
    });
  });

  it("debounces two characters and aborts a superseded request deterministically", async () => {
    vi.useFakeTimers();
    const searchSignals: AbortSignal[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (requestUrl(input).endsWith("/api/search/file-roots")) {
          return Promise.resolve(jsonResponse({ roots: [FIRST_ROOT] }));
        }
        const signal = init?.signal;
        if (!signal) throw new Error("Expected React Query to pass an AbortSignal");
        searchSignals.push(signal);
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        });
      }),
    );
    renderSearch({ initialQuery: "" });
    await act(async () => Promise.resolve());
    const input = screen.getByRole("searchbox", { name: "Search file contents" });

    fireEvent.change(input, { target: { value: "a" } });
    await act(async () => vi.advanceTimersByTimeAsync(500));
    fireEvent.change(input, { target: { value: "al" } });
    await act(async () => vi.advanceTimersByTimeAsync(199));
    const beforeMinimumDelay = searchSignals.length;
    await act(async () => vi.advanceTimersByTimeAsync(1));
    fireEvent.change(input, { target: { value: "ali" } });
    await act(async () => vi.advanceTimersByTimeAsync(200));

    expect({
      beforeMinimumDelay,
      signalCount: searchSignals.length,
      signalStates: searchSignals.map((signal) => signal.aborted),
    }).toStrictEqual({
      beforeMinimumDelay: 0,
      signalCount: 2,
      signalStates: [true, false],
    });
  });

  it("keeps the exact scope through narrowing, breadcrumbs, and root switches", async () => {
    const scopes: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(requestUrl(input), "http://example.com");
        if (url.pathname === "/api/search/file-roots") {
          return jsonResponse({ roots: [FIRST_ROOT, SECOND_ROOT] });
        }
        scopes.push(url.searchParams.get("scopeRoot") ?? "missing");
        const scope = url.searchParams.get("scopeRoot");
        return jsonResponse(
          searchResult([scope === SECOND_ROOT ? `${SECOND_ROOT}/charlie.ts` : FIRST_PATH]),
        );
      }),
    );
    renderSearch();
    await screen.findByRole("button", { name: `Search within ${FIRST_ROOT}/alice-folder` });

    fireEvent.click(
      screen.getByRole("button", { name: `Search within ${FIRST_ROOT}/alice-folder` }),
    );
    await waitFor(() => expect(scopes).toStrictEqual([FIRST_ROOT, `${FIRST_ROOT}/alice-folder`]));
    fireEvent.click(screen.getByRole("button", { name: "allowed" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Search root" }), {
      target: { value: SECOND_ROOT },
    });
    await waitFor(() =>
      expect(scopes).toStrictEqual([FIRST_ROOT, `${FIRST_ROOT}/alice-folder`, SECOND_ROOT]),
    );
    const input = screen.getByRole("searchbox", { name: "Search file contents" });
    const secondRootCard = await screen.findByRole("button", {
      name: `Open ${SECOND_ROOT}/charlie.ts at line 100`,
    });
    fireEvent.keyDown(input, { key: "ArrowDown" });

    expect({
      activeResult: document.activeElement?.getAttribute("aria-label"),
      activeRoot: (screen.getByRole("combobox", { name: "Search root" }) as HTMLSelectElement)
        .value,
      scopes,
    }).toStrictEqual({
      activeResult: secondRootCard.getAttribute("aria-label"),
      activeRoot: SECOND_ROOT,
      scopes: [FIRST_ROOT, `${FIRST_ROOT}/alice-folder`, SECOND_ROOT],
    });
  });

  it("restores the URL query into the input and reports edits for replace navigation", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        requestUrl(input).endsWith("/api/search/file-roots")
          ? jsonResponse({ roots: [FIRST_ROOT] })
          : jsonResponse(searchResult([])),
      ),
    );
    const { onQueryChange } = renderSearch({ initialQuery: "reloaded query" });
    const input = screen.getByRole("searchbox", {
      name: "Search file contents",
    }) as HTMLInputElement;
    const initialValue = input.value;

    fireEvent.change(input, { target: { value: "updated query" } });

    expect({ initialValue, queryChangeCalls: onQueryChange.mock.calls }).toStrictEqual({
      initialValue: "reloaded query",
      queryChangeCalls: [["updated query"]],
    });
  });

  it("renders loading, empty, and error states", async () => {
    let outcome: "loading" | "empty" | "error" = "loading";
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        if (requestUrl(input).endsWith("/api/search/file-roots")) {
          return Promise.resolve(jsonResponse({ roots: [FIRST_ROOT] }));
        }
        if (outcome === "loading") return new Promise<Response>(() => undefined);
        if (outcome === "error") return Promise.resolve(jsonResponse({ error: "fabricated" }, 500));
        return Promise.resolve(jsonResponse(searchResult([])));
      }),
    );
    const first = renderSearch();
    expect((await screen.findByRole("status")).textContent).toBe(" Searching files...");
    first.view.unmount();

    outcome = "empty";
    const second = renderSearch();
    expect(await screen.findByText("No file matches for “needle”.")).toBeTruthy();
    second.view.unmount();

    outcome = "error";
    renderSearch();
    expect((await screen.findByRole("alert")).textContent).toBe("File search failed. Try again.");
  });

  it("restores a validated URL query and builds an encoded viewer hash target", () => {
    const search = validateSearchParameters({ q: "needle", mode: "files" });
    const invalidSearch = validateSearchParameters({ q: 100, mode: "fabricated" });
    const navigation = fileSearchViewerNavigation("/tmp/test/with space/alice#notes.ts", 100);

    expect({
      decodedPath: decodeFilePath(navigation.pathToken),
      invalidSearch,
      navigation,
      search,
      target: fileSearchViewerTarget("/tmp/test/alice.ts", 200),
    }).toStrictEqual({
      decodedPath: "/tmp/test/with space/alice#notes.ts",
      invalidSearch: { q: "", mode: "titles" },
      navigation: {
        pathToken: "L3RtcC90ZXN0L3dpdGggc3BhY2UvYWxpY2Ujbm90ZXMudHM",
        hash: "L100",
      },
      search: { q: "needle", mode: "files" },
      target: { absolutePath: "/tmp/test/alice.ts", lineNumber: 200 },
    });
  });

  it("exposes only resolved roots from the roots endpoint response", async () => {
    const response = fileSearchRootsResponse([FIRST_ROOT, SECOND_ROOT]);

    expect({
      body: await response.json(),
      cacheControl: response.headers.get("Cache-Control"),
      status: response.status,
    }).toStrictEqual({
      body: { roots: [FIRST_ROOT, SECOND_ROOT] },
      cacheControl: "private, max-age=0, must-revalidate",
      status: 200,
    });
  });
});
