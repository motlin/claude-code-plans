// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { CommandPalette, PALETTE_RECENT_LIMIT } from "../src/components/command-palette";
import { useCommandPalette } from "../src/hooks/use-command-palette";
import type { UnifiedSearchItem } from "../src/lib/api/search";
import { recentSessionsQueryOptions } from "../src/lib/api/sessions";

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const YEAR_MS = 365 * 24 * 60 * 60_000;

function recentSession(id: string, title: string) {
  return {
    id,
    title,
    summary: undefined,
    mtime: new Date().toISOString(),
    created: new Date(0).toISOString(),
    project: "/users/dev/project-a",
    projectName: "project-a",
    messageCount: 1,
    gitBranch: undefined,
    starred: false,
    state: "unknown" as const,
    bucket: "done" as const,
    liveAgentCount: 0,
    unseen: false,
    blockedSince: null,
  };
}

function serverSession(
  id: string,
  title: string,
  overrides: Partial<UnifiedSearchItem> = {},
): UnifiedSearchItem {
  return {
    kind: "session",
    id,
    title,
    titleMatches: [],
    projectId: "-users-dev-project-a",
    projectName: "project-a",
    mtime: new Date().toISOString(),
    ...overrides,
  };
}

interface PendingSearch {
  url: string;
  resolve: (items: UnifiedSearchItem[]) => void;
}

let pending: PendingSearch[] = [];

function fetchMock(url: string): Promise<unknown> {
  return new Promise((resolveFetch) => {
    pending.push({
      url,
      resolve: (items) => resolveFetch({ ok: true, status: 200, json: async () => ({ items }) }),
    });
  });
}

function Harness() {
  const palette = useCommandPalette();
  return (
    <>
      <textarea aria-label="Composer" />
      <CommandPalette {...palette} />
    </>
  );
}

async function openPalette(sessions = [recentSession("sess-1", "Refactor auth module")]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(recentSessionsQueryOptions(PALETTE_RECENT_LIMIT).queryKey, {
    sessions,
    nextCursor: null,
  });
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <Harness />
        <Outlet />
      </QueryClientProvider>
    ),
  });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => null,
  });
  const searchRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "search",
    validateSearch: (search: Record<string, unknown>) => search,
    component: () => null,
  });
  const sessionRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "session/$id",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, searchRoute, sessionRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  const composer = await screen.findByRole("textbox", { name: "Composer" });
  composer.focus();
  fireEvent.keyDown(composer, { key: "k", code: "KeyK", metaKey: true });
  const dialog = await screen.findByRole("dialog", { name: "Search" });
  return { dialog, router };
}

function type(dialog: HTMLElement, value: string) {
  fireEvent.change(within(dialog).getByRole("combobox"), { target: { value } });
}

function resultsGroup(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByRole("group", { name: "Search results" });
}

function optionLabels(dialog: HTMLElement): string[] {
  return [...resultsGroup(dialog).querySelectorAll("[cmdk-item]")].map(
    (item) => item.querySelector("[data-palette-label]")?.textContent ?? "",
  );
}

function option(dialog: HTMLElement, label: string): HTMLElement {
  const match = [...resultsGroup(dialog).querySelectorAll<HTMLElement>("[cmdk-item]")].find(
    (item) => item.querySelector("[data-palette-label]")?.textContent === label,
  );
  if (match === undefined) throw new Error(`No option labelled ${label}`);
  return match;
}

function boldRuns(element: Element): string[] {
  return [...element.querySelectorAll(".font-semibold.text-primary")].map(
    (run) => run.textContent ?? "",
  );
}

async function awaitRequest(): Promise<PendingSearch> {
  await waitFor(() => expect(pending.length).toBe(1));
  const [request] = pending;
  if (request === undefined) throw new Error("no request");
  return request;
}

describe("⌘K palette live search", () => {
  beforeEach(() => {
    pending = [];
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_UA);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    Element.prototype.scrollIntoView = () => {};
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps instant title matches in place when server rows arrive", async () => {
    const { dialog } = await openPalette();

    type(dialog, "auth");

    expect(optionLabels(dialog)).toStrictEqual([
      "Refactor auth module",
      "See all results for “auth”",
    ]);

    const request = await awaitRequest();
    expect(request.url).toBe("/api/search?query=auth");
    request.resolve([
      serverSession("sess-2", "Auth token refresh", { titleMatches: [{ start: 0, end: 4 }] }),
      serverSession("sess-1", "Refactor auth module"),
      {
        ...serverSession("auth-plan.md", "auth-plan.md"),
        kind: "plan",
        href: "/plan/auth-plan",
      },
    ]);

    await waitFor(() =>
      expect(optionLabels(dialog)).toStrictEqual([
        "Refactor auth module",
        "Auth token refresh",
        "auth-plan.md",
        "See all results for “auth”",
      ]),
    );
    expect(
      [...resultsGroup(dialog).querySelectorAll("[cmdk-item]")].map((item) =>
        item.getAttribute("data-item-type"),
      ),
    ).toStrictEqual(["session", "session", "plan", null]);
  });

  it("renders matched runs in bold for instant and server rows", async () => {
    const { dialog } = await openPalette();

    type(dialog, "auth");
    (await awaitRequest()).resolve([
      serverSession("sess-2", "Auth token refresh", { titleMatches: [{ start: 0, end: 4 }] }),
    ]);

    await waitFor(() => expect(optionLabels(dialog)).toContain("Auth token refresh"));
    expect({
      instant: boldRuns(option(dialog, "Refactor auth module")),
      server: boldRuns(option(dialog, "Auth token refresh")),
    }).toStrictEqual({ instant: ["auth"], server: ["Auth"] });
  });

  it("quotes content snippets beside the title", async () => {
    const { dialog } = await openPalette([]);

    type(dialog, "hashing");
    (await awaitRequest()).resolve([
      serverSession("sess-3", "Cache layer", {
        snippet: { text: "the HashingStrategy exists", matches: [{ start: 4, end: 11 }] },
      }),
    ]);

    await waitFor(() => expect(optionLabels(dialog)).toContain("Cache layer"));
    const snippet = option(dialog, "Cache layer").querySelector("[data-palette-snippet]");
    expect({
      text: snippet?.textContent,
      className: snippet?.className,
      bold: snippet === null || snippet === undefined ? [] : boldRuns(snippet),
    }).toStrictEqual({
      text: "“the HashingStrategy exists”",
      className: "text-xs text-ink-muted max-w-[60%] shrink-0 overflow-hidden whitespace-nowrap",
      bold: ["Hashing"],
    });
  });

  it("shows a relative bucket meta and leaves it empty beyond a year", async () => {
    const { dialog } = await openPalette([]);

    type(dialog, "cache");
    (await awaitRequest()).resolve([
      serverSession("sess-4", "Cache now"),
      serverSession("sess-5", "Cache old", {
        mtime: new Date(Date.now() - 2 * YEAR_MS).toISOString(),
      }),
    ]);

    await waitFor(() => expect(optionLabels(dialog)).toContain("Cache old"));
    expect({
      now: option(dialog, "Cache now").querySelector("[data-palette-meta]")?.textContent,
      old: option(dialog, "Cache old").querySelector("[data-palette-meta]")?.textContent,
    }).toStrictEqual({ now: "Just now", old: "" });
  });

  it("marks sessions awaiting input with a pulse dot", async () => {
    const { dialog } = await openPalette([]);

    type(dialog, "deploy");
    (await awaitRequest()).resolve([
      serverSession("sess-6", "Deploy waiting", { state: "waiting" }),
      serverSession("sess-7", "Deploy idle", { state: "idle" }),
    ]);

    await waitFor(() => expect(optionLabels(dialog)).toContain("Deploy idle"));
    expect({
      waiting: option(dialog, "Deploy waiting").querySelector("[data-palette-attention-dot]")
        ?.tagName,
      waitingSr: option(dialog, "Deploy waiting").querySelector(".sr-only")?.textContent,
      idle: option(dialog, "Deploy idle").querySelector("[data-palette-attention-dot]"),
    }).toStrictEqual({ waiting: "SPAN", waitingSr: " Awaiting input", idle: null });
  });

  it("shows the deeper-search spinner and skeletons only while fetching", async () => {
    const { dialog } = await openPalette();

    type(dialog, "auth");
    const request = await awaitRequest();

    expect({
      spinner: within(dialog).queryByLabelText("Searching deeper...") !== null,
      skeletons: dialog.querySelectorAll("[data-palette-skeleton]").length > 0,
      busy: resultsGroup(dialog).getAttribute("aria-busy"),
    }).toStrictEqual({ spinner: true, skeletons: true, busy: "true" });

    request.resolve([serverSession("sess-2", "Auth token refresh")]);

    await waitFor(() => expect(within(dialog).queryByLabelText("Searching deeper...")).toBeNull());
    expect({
      skeletons: dialog.querySelectorAll("[data-palette-skeleton]").length,
      busy: resultsGroup(dialog).getAttribute("aria-busy"),
    }).toStrictEqual({ skeletons: 0, busy: "false" });
  });

  it("announces the result count politely once the search settles", async () => {
    const { dialog } = await openPalette();

    type(dialog, "auth");
    (await awaitRequest()).resolve([
      serverSession("sess-2", "Auth token refresh"),
      serverSession("sess-8", "Auth docs"),
    ]);

    await waitFor(() =>
      expect(dialog.querySelector("[aria-live=polite]")?.textContent).toBe("3 results available"),
    );
  });

  it("navigates to the search page with the query and type from the last row", async () => {
    const { dialog, router } = await openPalette();

    type(dialog, "auth");
    fireEvent.click(option(dialog, "See all results for “auth”"));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect({
      pathname: router.state.location.pathname,
      q: router.state.location.search["q" as never],
      type: router.state.location.search["type" as never],
    }).toStrictEqual({ pathname: "/search", q: "auth", type: "all" });
  });
});

describe("⌘K palette filters", () => {
  beforeEach(() => {
    pending = [];
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_UA);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    Element.prototype.scrollIntoView = () => {};
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function tabs(dialog: HTMLElement) {
    return within(within(dialog).getByRole("tablist", { name: "Type" }))
      .getAllByRole("tab")
      .map((tab) => ({ name: tab.textContent, selected: tab.getAttribute("aria-selected") }));
  }

  function filterLabels(dialog: HTMLElement): string[] {
    return [
      ...within(dialog).getByRole("group", { name: "Filters" }).querySelectorAll("[cmdk-item]"),
    ].map((item) => item.querySelector("[data-palette-label]")?.textContent ?? "");
  }

  it("renders local type tabs with All selected", async () => {
    const { dialog } = await openPalette();

    expect(tabs(dialog)).toStrictEqual([
      { name: "All", selected: "true" },
      { name: "Sessions", selected: "false" },
      { name: "Plans", selected: "false" },
      { name: "Memories", selected: "false" },
      { name: "Files", selected: "false" },
      { name: "Projects", selected: "false" },
    ]);
  });

  it("lists the Filter by hints when / is the whole query", async () => {
    const { dialog } = await openPalette();

    type(dialog, "/");

    expect(filterLabels(dialog)).toStrictEqual([
      "Filter by Project",
      "Filter by Date",
      "Filter by Repo",
      "Filter by Type",
    ]);
    expect(pending).toStrictEqual([]);
  });

  it("narrows the hints as you type", async () => {
    const { dialog } = await openPalette();

    type(dialog, "/re");

    expect(filterLabels(dialog)).toStrictEqual(["Filter by Date", "Filter by Repo"]);
  });

  it("inserts the filter token when a hint is chosen", async () => {
    const { dialog } = await openPalette();

    type(dialog, "/re");
    const repo = [
      ...within(dialog).getByRole("group", { name: "Filters" }).querySelectorAll("[cmdk-item]"),
    ].find((item) => item.textContent?.includes("Repo"));
    if (repo === undefined) throw new Error("no Repo hint");
    fireEvent.click(repo);

    expect(within(dialog).getByRole("combobox")).toHaveProperty("value", "repo:");
  });

  it("lists recents with bucket meta on the Sessions tab with an empty query", async () => {
    const { dialog } = await openPalette([
      recentSession("sess-1", "Refactor auth module"),
      recentSession("sess-2", "Fix login"),
    ]);

    fireEvent.click(within(dialog).getByRole("tab", { name: "Sessions" }));

    expect({
      labels: optionLabels(dialog),
      meta: [...resultsGroup(dialog).querySelectorAll("[data-palette-meta]")].map(
        (meta) => meta.textContent,
      ),
      headings: [...dialog.querySelectorAll("[cmdk-group-heading]")].map(
        (heading) => heading.textContent,
      ),
    }).toStrictEqual({
      labels: ["Refactor auth module", "Fix login"],
      meta: ["Just now", "Just now"],
      headings: [],
    });
  });

  it("maps tokens onto the search request", async () => {
    const { dialog } = await openPalette([]);

    type(dialog, "date:week type:plans auth");

    expect((await awaitRequest()).url).toBe("/api/search?query=auth&type=plans&date=week");
  });

  it("shows the filtered no-results copy and Search all resets the tab", async () => {
    const { dialog } = await openPalette([]);

    fireEvent.click(within(dialog).getByRole("tab", { name: "Sessions" }));
    type(dialog, "zzqxvq");
    const request = await awaitRequest();
    expect(request.url).toBe("/api/search?query=zzqxvq&type=sessions");
    request.resolve([]);

    await within(dialog).findByText("No results for “zzqxvq” in Sessions");
    fireEvent.click(within(dialog).getByRole("button", { name: "Search all" }));

    expect(tabs(dialog)[0]).toStrictEqual({ name: "All", selected: "true" });
    await waitFor(() =>
      expect(pending.map((search) => search.url)).toContain("/api/search?query=zzqxvq"),
    );
  });
});
