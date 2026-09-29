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
import { ToastProvider } from "../src/components/toast";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { SessionGroups } from "../src/components/sidebar/session-groups";
import {
  RecentSessionsResponse,
  recentSessionsInfiniteQueryOptions,
} from "../src/lib/api/sessions";
import type { SessionBucket } from "../src/lib/session-state";
import { readSidebarState } from "../src/lib/sidebar-store";
import { installLocalStorage } from "./fake-storage";

const MINUTE = 60 * 1000;

function session(id: string, title: string, bucket: SessionBucket, minutesAgo: number) {
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
    unseen: bucket === "review",
    blockedSince: null,
  };
}

const FIXTURE = [
  session("d1", "Completed newest", "done", 5),
  session("w1", "Working one", "working", 1),
  session("r1", "Review one", "review", 2),
  session("b1", "Blocked one", "blocked", 3),
  session("d2", "Completed older", "done", 30),
];

function seedQueryClient(sessions: unknown[], nextCursor: string | null = null): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity, refetchOnMount: false },
    },
  });
  queryClient.setQueryData(recentSessionsInfiniteQueryOptions().queryKey, {
    pages: [RecentSessionsResponse.parse({ sessions, nextCursor })],
    pageParams: [null],
  });
  return queryClient;
}

async function renderGroups(
  sessions: unknown[],
  options: { nextCursor?: string | null; filterSlot?: ReactNode } = {},
) {
  const queryClient = seedQueryClient(sessions, options.nextCursor ?? null);
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <SessionGroups activeItemId={null} filterSlot={options.filterSlot} />
          <Outlet />
        </ToastProvider>
      </QueryClientProvider>
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
  return result;
}

function groupNames(container: HTMLElement): string[] {
  return [...container.querySelectorAll("[data-group-name]")].map((node) => node.textContent ?? "");
}

function rowTitlesIn(container: HTMLElement, groupKey: string): string[] {
  const section = container.querySelector(`[data-group-key="${groupKey}"]`);
  if (!(section instanceof HTMLElement)) return [];
  return [...section.querySelectorAll("a[data-row-main-button]")].map(
    (link) => link.textContent ?? "",
  );
}

afterEach(cleanup);

beforeEach(() => {
  installLocalStorage();
});

describe("sidebar SessionGroups", () => {
  it("renders the state groups in upstream order with their rows", async () => {
    const { container } = await renderGroups(FIXTURE);

    expect(groupNames(container)).toEqual([
      "Needs input",
      "Ready for review",
      "Working",
      "Completed",
    ]);
    expect({
      blocked: rowTitlesIn(container, "state-blocked"),
      review: rowTitlesIn(container, "state-review"),
      working: rowTitlesIn(container, "state-working"),
      done: rowTitlesIn(container, "state-done"),
    }).toEqual({
      blocked: ["Blocked one"],
      review: ["Review one"],
      working: ["Working one"],
      done: ["Completed newest", "Completed older"],
    });
  });

  it("omits empty groups", async () => {
    const { container } = await renderGroups([
      session("w1", "Working one", "working", 1),
      session("d1", "Completed one", "done", 5),
    ]);

    expect(groupNames(container)).toEqual(["Working", "Completed"]);
  });

  it("shows each row's session title with its state icon", async () => {
    await renderGroups(FIXTURE);

    // The icon's aria-label joins the title in the accessible name, as upstream's markup does.
    const blocked = screen.getByRole("link", { name: /Blocked one$/ });
    expect(blocked.getAttribute("href")).toBe("/session/b1");
    expect(within(blocked).getByRole("status").getAttribute("aria-label")).toBe("Awaiting input");
    expect(
      within(screen.getByRole("link", { name: /Working one$/ }))
        .getByRole("status")
        .getAttribute("aria-label"),
    ).toBe("Running");
    expect(
      within(screen.getByRole("link", { name: /Completed older$/ }))
        .getByRole("img")
        .getAttribute("aria-label"),
    ).toBe("Idle");
    expect(screen.queryByText("project-b1")).toBeNull();
  });

  it("collapses a group, persists it in the sidebar store, and restores it on remount", async () => {
    const first = await renderGroups(FIXTURE);
    const toggle = screen.getByRole("button", { name: "Working" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("link", { name: /Working one/ })).toBeNull();
    expect(readSidebarState().collapsedGroups).toEqual(["state-working"]);

    first.unmount();
    await renderGroups(FIXTURE);

    const remounted = screen.getByRole("button", { name: "Working" });
    expect(remounted.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("link", { name: /Working one/ })).toBeNull();

    fireEvent.click(remounted);

    expect(remounted.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("link", { name: /Working one$/ })).toBeTruthy();
    expect(readSidebarState().collapsedGroups).toEqual([]);
  });

  it("caps Completed at 20 rows and expands the rest in place from Show N more", async () => {
    const done = Array.from({ length: 23 }, (_, index) =>
      session(`d${index}`, `Done ${index}`, "done", index + 1),
    );
    const { container } = await renderGroups(done);

    expect(rowTitlesIn(container, "state-done")).toHaveLength(20);
    const showMore = screen.getByRole("button", { name: "Show 3 more in Completed" });
    expect(showMore.textContent).toBe("Show 3 more");

    fireEvent.click(showMore);

    expect(rowTitlesIn(container, "state-done")).toEqual(
      Array.from({ length: 23 }, (_, index) => `Done ${index}`),
    );
    expect(screen.queryByRole("button", { name: /^Show \d+ more/ })).toBeNull();
  });

  it("puts the filter slot on the first group header only", async () => {
    const { container } = await renderGroups(
      [session("w1", "Working one", "working", 1), session("d1", "Completed one", "done", 5)],
      { filterSlot: <button type="button">Filter</button> },
    );

    const headers = [...container.querySelectorAll("[data-sidebar-group-label]")];
    expect(
      headers.map((header) => within(header as HTMLElement).queryAllByText("Filter").length),
    ).toEqual([1, 0]);
    expect(within(headers[0] as HTMLElement).getByRole("button", { name: "Working" })).toBeTruthy();
  });

  it("offers Load more sessions only while the feed has another page", async () => {
    const withMore = await renderGroups(FIXTURE, { nextCursor: "cursor-2" });
    expect(screen.getByRole("button", { name: "Load more sessions" })).toBeTruthy();
    withMore.unmount();

    await renderGroups(FIXTURE);
    expect(screen.queryByRole("button", { name: "Load more sessions" })).toBeNull();
  });
});
