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
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ToastProvider } from "../src/components/toast";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { SettingsProvider } from "../src/components/settings-provider";
import { SidebarSessionGroups } from "../src/components/sidebar/session-filter-menu";
import {
  RecentSessionsResponse,
  recentSessionsInfiniteQueryOptions,
} from "../src/lib/api/sessions";
import { DEFAULT_SESSION_LIST_PREFS, type SessionListPrefs } from "../src/lib/session-groups";
import type { SessionBucket } from "../src/lib/session-state";
import { installLocalStorage } from "./fake-storage";

const MINUTE = 60 * 1000;
const PREFS_KEY = "ccp-session-list-prefs";

function session(id: string, title: string, bucket: SessionBucket, projectName: string) {
  const mtime = new Date(Date.now() - MINUTE).toISOString();
  return {
    id,
    title,
    mtime,
    created: mtime,
    project: `-projects-${projectName}`,
    projectName,
    messageCount: 4,
    starred: false,
    state: bucket === "working" ? "working" : bucket === "blocked" ? "waiting" : "idle",
    bucket,
    liveAgentCount: 0,
    unseen: bucket === "review",
    blockedSince: null,
  };
}

const FIXTURE = [
  session("w1", "Working one", "working", "beta"),
  session("d1", "Completed one", "done", "alpha"),
];

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function storePrefs(prefs: Partial<SessionListPrefs>) {
  localStorage.setItem(PREFS_KEY, JSON.stringify({ ...DEFAULT_SESSION_LIST_PREFS, ...prefs }));
}

function storedPrefs(): unknown {
  const raw = localStorage.getItem(PREFS_KEY);
  return raw === null ? null : JSON.parse(raw);
}

async function renderSidebarGroups() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity, refetchOnMount: false },
    },
  });
  queryClient.setQueryData(recentSessionsInfiniteQueryOptions().queryKey, {
    pages: [RecentSessionsResponse.parse({ sessions: FIXTURE, nextCursor: null })],
    pageParams: [null],
  });
  const rootRoute = createRootRoute({
    component: () => (
      <SettingsProvider>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <SidebarSessionGroups activeItemId={null} />
            <Outlet />
          </ToastProvider>
        </QueryClientProvider>
      </SettingsProvider>
    ),
  });
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => null,
  });
  const sessionRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/session/$id",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([homeRoute, sessionRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  const result = render(<RouterProvider router={router} />);
  await waitFor(() => expect(result.container.querySelector("[data-group-toggle]")).toBeTruthy());
  await flush();
  return result;
}

function groupNames(container: HTMLElement): string[] {
  return [...container.querySelectorAll("[data-group-name]")].map((node) => node.textContent ?? "");
}

function filterButton(): HTMLElement {
  return screen.getByRole("button", { name: /^Filter/ });
}

async function openFilterMenu(): Promise<HTMLElement> {
  fireEvent.click(filterButton());
  await flush();
  return screen.getByRole("menu");
}

function menuOutline(menu: HTMLElement): string[] {
  return [
    ...menu.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"], [role="separator"]'),
  ].map((node) =>
    node.getAttribute("role") === "separator" ? "---" : (node.textContent ?? "").trim(),
  );
}

async function openSubmenu(name: RegExp): Promise<void> {
  const trigger = screen.getByRole("menuitem", { name });
  act(() => trigger.focus());
  fireEvent.keyDown(trigger, { key: "ArrowRight" });
  await flush();
}

afterEach(cleanup);

beforeEach(() => {
  installLocalStorage();
});

describe("sidebar Filter & group menu", () => {
  it("sits on the first group header only, labelled Filter by default", async () => {
    const { container } = await renderSidebarGroups();

    const headers = [...container.querySelectorAll("[data-sidebar-group-label]")];
    expect(
      headers.map((header) => header.querySelectorAll('button[aria-haspopup="menu"]').length),
    ).toEqual([1, 0]);
    expect(filterButton().getAttribute("aria-label")).toBe("Filter");
  });

  it("lists State-mode items in upstream order", async () => {
    await renderSidebarGroups();
    const menu = await openFilterMenu();

    expect(menuOutline(menu)).toEqual([
      "StatusActive",
      "Last activity7d",
      "---",
      "Group byState",
      "Sort byLast activity",
      "---",
      "Clear filters",
    ]);
  });

  it("hides Last activity and shows Show empty groups in Project mode", async () => {
    storePrefs({ groupBy: "project" });
    await renderSidebarGroups();
    const menu = await openFilterMenu();

    expect(menuOutline(menu)).toEqual([
      "StatusActive",
      "---",
      "Group byProject",
      "Sort byLast activity",
      "---",
      "Show empty groups",
      "---",
      "Clear filters",
    ]);
  });

  it("marks non-default trailing values in accent", async () => {
    storePrefs({ groupBy: "project" });
    await renderSidebarGroups();
    await openFilterMenu();

    const accentOf = (name: RegExp) =>
      screen
        .getByRole("menuitem", { name })
        .querySelector("[data-menu-value]")
        ?.className.includes("text-accent-100");
    expect([accentOf(/^Status/), accentOf(/^Group by/)]).toEqual([false, true]);
  });

  it("opens a submenu with ArrowRight", async () => {
    await renderSidebarGroups();
    await openFilterMenu();
    await openSubmenu(/^Group by/);

    expect(screen.getAllByRole("menu")).toHaveLength(2);
    expect(
      screen
        .getAllByRole("menuitemradio")
        .map((node) => [node.textContent, node.getAttribute("aria-checked")]),
    ).toEqual([
      ["Date", "false"],
      ["Project", "false"],
      ["State", "true"],
      ["None", "false"],
    ]);
  });

  it("regroups the list and persists when a Group by option is chosen", async () => {
    const { container } = await renderSidebarGroups();
    expect(groupNames(container)).toEqual(["Working", "Completed"]);

    await openFilterMenu();
    await openSubmenu(/^Group by/);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Project" }));
    await flush();

    expect(groupNames(container)).toEqual(["alpha", "beta"]);
    expect(storedPrefs()).toEqual({ ...DEFAULT_SESSION_LIST_PREFS, groupBy: "project" });
  });

  it('becomes "Filter (active)" once a non-default filter is chosen', async () => {
    await renderSidebarGroups();
    await openFilterMenu();
    await openSubmenu(/^Status/);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "All" }));
    await flush();

    expect(filterButton().getAttribute("aria-label")).toBe("Filter (active)");
    expect(storedPrefs()).toEqual({ ...DEFAULT_SESSION_LIST_PREFS, statusFilter: "all" });
  });

  it("resets the filters with Clear filters", async () => {
    storePrefs({ statusFilter: "all", activityDays: "1d", sortBy: "name" });
    await renderSidebarGroups();
    expect(filterButton().getAttribute("aria-label")).toBe("Filter (active)");

    await openFilterMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Clear filters" }));
    await flush();

    expect(filterButton().getAttribute("aria-label")).toBe("Filter");
    expect(storedPrefs()).toEqual({ ...DEFAULT_SESSION_LIST_PREFS, sortBy: "name" });
  });
});
