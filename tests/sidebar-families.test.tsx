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
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { SessionGroups } from "../src/components/sidebar/session-groups";
import { ToastProvider } from "../src/components/toast";
import {
  RecentSessionsResponse,
  recentSessionsInfiniteQueryOptions,
} from "../src/lib/api/sessions";
import type { SessionBucket } from "../src/lib/session-state";
import { readSidebarState } from "../src/lib/sidebar-store";
import { installLocalStorage } from "./fake-storage";

const MINUTE = 60 * 1000;

function session(
  id: string,
  title: string,
  bucket: SessionBucket,
  minutesAgo: number,
  extra: { forkedFromSessionId?: string; unseen?: boolean } = {},
) {
  const mtime = new Date(Date.now() - minutesAgo * MINUTE).toISOString();
  return {
    id,
    title,
    mtime,
    created: mtime,
    project: `-projects-${id}`,
    projectName: `project-${id}`,
    messageCount: 4,
    archived: false,
    state: bucket === "working" ? "working" : bucket === "blocked" ? "waiting" : "idle",
    bucket,
    liveAgentCount: 0,
    unseen: extra.unseen ?? false,
    blockedSince: null,
    ...(extra.forkedFromSessionId === undefined
      ? {}
      : { forkedFromSessionId: extra.forkedFromSessionId }),
  };
}

// Head h1 is done, but its family takes the most urgent member bucket (Working).
const FAMILY = [
  session("h1", "Head one", "done", 10),
  session("c1", "Child one", "working", 1, { forkedFromSessionId: "h1" }),
  session("g1", "Grandchild one", "review", 2, { forkedFromSessionId: "c1", unseen: true }),
  session("s1", "Solo one", "working", 3),
];

const TWO_FAMILIES = [
  ...FAMILY,
  session("h2", "Head two", "working", 4),
  session("c2", "Child two", "working", 5, { forkedFromSessionId: "h2" }),
];

async function renderGroups(sessions: unknown[]) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity, refetchOnMount: false },
    },
  });
  queryClient.setQueryData(recentSessionsInfiniteQueryOptions().queryKey, {
    pages: [RecentSessionsResponse.parse({ sessions, nextCursor: null })],
    pageParams: [null],
  });
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <SessionGroups activeItemId={null} />
          <Outlet />
        </ToastProvider>
      </QueryClientProvider>
    ),
  });
  const sessionRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/session/$id",
    component: () => null,
  });
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([homeRoute, sessionRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  const result = render(<RouterProvider router={router} />);
  await waitFor(() => expect(result.container.querySelector("[data-group-toggle]")).toBeTruthy());
  return result;
}

function family(container: HTMLElement, headId: string): HTMLElement {
  const element = container.querySelector(`.df-family[data-family-head="${headId}"]`);
  if (!(element instanceof HTMLElement)) throw new Error(`no family for ${headId}`);
  return element;
}

function rowTitles(element: Element): string[] {
  return [...element.querySelectorAll("a[data-row-main-button] [data-row-label]")].map(
    (label) => label.textContent ?? "",
  );
}

function handle(container: HTMLElement, headId: string): HTMLElement {
  const element = family(container, headId).querySelector("button.df-family-handle");
  if (!(element instanceof HTMLElement)) throw new Error(`no handle for ${headId}`);
  return element;
}

afterEach(cleanup);

beforeEach(() => {
  installLocalStorage();
});

describe("sidebar session families", () => {
  it("nests forks under their top ancestor in the family's most urgent group, indented 20px", async () => {
    const { container } = await renderGroups(FAMILY);

    const working = container.querySelector('[data-group-key="state-working"]');
    if (!(working instanceof HTMLElement)) throw new Error("no Working group");
    expect(rowTitles(working)).toStrictEqual([
      "Solo one",
      "Head one",
      "Child one",
      "Grandchild one",
    ]);
    expect(container.querySelector('[data-group-key="state-done"]')).toBeNull();
    expect(container.querySelector('[data-group-key="state-review"]')).toBeNull();

    const nested = family(container, "h1");
    expect(rowTitles(nested)).toStrictEqual(["Child one", "Grandchild one"]);
    const childWrappers = [...nested.querySelectorAll(":scope > [data-family-child]")];
    expect(childWrappers.map((wrapper) => wrapper.classList.contains("pl-5"))).toStrictEqual([
      true,
      true,
    ]);
    const headWrapper = nested.previousElementSibling;
    expect(headWrapper?.hasAttribute("data-family-child")).toBe(false);
    expect(headWrapper?.classList.contains("pl-5")).toBe(false);
    expect(rowTitles(headWrapper ?? nested)).toStrictEqual(["Head one"]);
    expect(
      [...nested.querySelectorAll("[data-family-lineage]")].map((label) => label.textContent),
    ).toStrictEqual(["Forked from Head one", "Forked from Child one"]);
  });

  it("collapses a family to a stub row from its handle and persists collapsedFamilies", async () => {
    const first = await renderGroups(FAMILY);
    const toggle = handle(first.container, "h1");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-label")).toBe("Hide nested sessions");
    expect(toggle.tabIndex).toBe(-1);

    fireEvent.click(toggle);

    expect(readSidebarState().collapsedFamilies).toStrictEqual(["code:h1"]);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-label")).toBe("Show nested sessions");
    expect(rowTitles(family(first.container, "h1"))).toStrictEqual([]);
    const stub = family(first.container, "h1").querySelector("button.df-family-stub");
    expect(stub?.textContent).toBe("2 nested sessions · 1 · 1");
    expect(stub?.getAttribute("aria-label")).toBe("2 nested sessions, 1 unread, 1 working");

    first.unmount();
    const second = await renderGroups(FAMILY);
    expect(rowTitles(family(second.container, "h1"))).toStrictEqual([]);

    fireEvent.click(handle(second.container, "h1"));

    expect(readSidebarState().collapsedFamilies).toStrictEqual([]);
    expect(rowTitles(family(second.container, "h1"))).toStrictEqual([
      "Child one",
      "Grandchild one",
    ]);
  });

  it("singularizes the stub and uses the needs-input label for a blocked child", async () => {
    const { container } = await renderGroups([
      session("h1", "Head one", "done", 10),
      session("c1", "Child one", "blocked", 1, { forkedFromSessionId: "h1" }),
    ]);

    fireEvent.click(handle(container, "h1"));

    const stub = family(container, "h1").querySelector("button.df-family-stub");
    expect(stub?.textContent).toBe("1 nested session");
    expect(stub?.getAttribute("aria-label")).toBe("1 nested session needs input");
  });

  it("toggles every family on Alt-click", async () => {
    const { container } = await renderGroups(TWO_FAMILIES);

    fireEvent.click(handle(container, "h2"), { altKey: true });

    expect([...readSidebarState().collapsedFamilies].sort()).toStrictEqual(["code:h1", "code:h2"]);
    expect(rowTitles(family(container, "h1"))).toStrictEqual([]);
    expect(rowTitles(family(container, "h2"))).toStrictEqual([]);

    fireEvent.click(handle(container, "h1"), { altKey: true });

    expect(readSidebarState().collapsedFamilies).toStrictEqual([]);
    expect(rowTitles(family(container, "h2"))).toStrictEqual(["Child two"]);
  });

  it("expands from the stub and focuses the first child", async () => {
    const { container } = await renderGroups(FAMILY);
    fireEvent.click(handle(container, "h1"));

    const stub = family(container, "h1").querySelector("button.df-family-stub");
    if (!(stub instanceof HTMLElement)) throw new Error("no stub");
    fireEvent.click(stub);

    expect(readSidebarState().collapsedFamilies).toStrictEqual([]);
    const firstChild = screen.getByRole("link", { name: /Child one\s*Forked from Head one$/ });
    await waitFor(() => expect(document.activeElement).toBe(firstChild));
  });
});
