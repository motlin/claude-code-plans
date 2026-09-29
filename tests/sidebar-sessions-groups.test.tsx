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
import { DEFAULTS, SettingsProvider } from "../src/components/settings-provider";
import { Sidebar } from "../src/components/sidebar/Sidebar";
import { applicationSettingsQueryOptions } from "../src/lib/api/application-settings";
import { approvalsQueryOptions } from "../src/lib/api/approvals";
import { notificationsQueryOptions } from "../src/lib/api/notifications";
import { projectsQueryOptions } from "../src/lib/api/projects";
import {
  activeSessionsQueryOptions,
  RecentSessionsResponse,
  recentSessionsInfiniteQueryOptions,
} from "../src/lib/api/sessions";
import { installLocalStorage } from "./fake-storage";
import { NAV_SECTIONS } from "../src/lib/nav-sections";

function session(id: string, title: string, bucket: string, minutesAgo: number) {
  const mtime = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  return {
    id,
    title,
    mtime,
    created: mtime,
    project: "gamma",
    projectName: "Gamma",
    messageCount: 4,
    archived: false,
    state: bucket === "working" ? "working" : "idle",
    bucket,
    liveAgentCount: 0,
    unseen: false,
    blockedSince: null,
  };
}

function seedQueryClient(): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity, refetchOnMount: false },
    },
  });
  queryClient.setQueryData(projectsQueryOptions().queryKey, []);
  queryClient.setQueryData(recentSessionsInfiniteQueryOptions().queryKey, {
    pages: [
      RecentSessionsResponse.parse({
        sessions: [
          session("w1", "Gamma working", "working", 1),
          session("d1", "Gamma done", "done", 10),
        ],
        nextCursor: null,
      }),
    ],
    pageParams: [null],
  });
  queryClient.setQueryData(approvalsQueryOptions().queryKey, { approvals: [] });
  queryClient.setQueryData(notificationsQueryOptions().queryKey, { notifications: [] });
  queryClient.setQueryData(
    activeSessionsQueryOptions(DEFAULTS.activeTimeoutSec * 1000).queryKey,
    [],
  );
  queryClient.setQueryData(applicationSettingsQueryOptions.queryKey, {
    herdrWritesEnabled: false,
    shellPaneEnabled: true,
    visibleNavSections: NAV_SECTIONS.filter((section) => section !== "herdr" && section !== "tmux"),
    ignoredDirs: ["node_modules"],
  });
  return queryClient;
}

async function renderSidebar(override?: (queryClient: QueryClient) => void) {
  const queryClient = seedQueryClient();
  override?.(queryClient);
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <SettingsProvider>
          <ToastProvider>
            <Sidebar collapsed={false} onToggle={() => {}} />
            <Outlet />
          </ToastProvider>
        </SettingsProvider>
      </QueryClientProvider>
    ),
  });
  const sessionsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/sessions",
    component: () => null,
  });
  const sessionRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/session/$id",
    component: () => null,
  });
  const plansRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/plans",
    component: () => null,
  });
  const projectRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/project/$id",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([sessionsRoute, sessionRoute, plansRoute, projectRoute]),
    history: createMemoryHistory({ initialEntries: ["/sessions"] }),
  });
  await router.load();
  const { container } = render(<RouterProvider router={router} />);
  return {
    container,
    navigate: async (options: { to: string; params?: Record<string, string> }) => {
      await act(async () => {
        await router.navigate(options as never);
      });
    },
  };
}

afterEach(cleanup);

beforeEach(() => {
  installLocalStorage();
});

describe("sidebar session list", () => {
  it("groups sessions by state with their titles", async () => {
    const { container } = await renderSidebar();

    await waitFor(() => expect(screen.getByRole("button", { name: "Working" })).toBeTruthy());

    expect(
      [...container.querySelectorAll('[data-testid="sidebar-recents"] [data-group-name]')].map(
        (node) => node.textContent,
      ),
    ).toEqual(["Working", "Completed"]);
    expect(screen.getByRole("link", { name: /Gamma working$/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Gamma done$/ })).toBeTruthy();
  });

  it("keeps a collapsed group collapsed after visiting a session", async () => {
    const { navigate } = await renderSidebar();

    await waitFor(() => expect(screen.getByRole("button", { name: "Completed" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Completed" }));
    expect(screen.queryByRole("link", { name: /Gamma done$/ })).toBeNull();

    await navigate({ to: "/session/$id", params: { id: "w1" } });
    await navigate({ to: "/plans" });

    await waitFor(() => expect(screen.getByRole("link", { name: /Gamma working$/ })).toBeTruthy());
    expect(screen.queryByRole("link", { name: /Gamma done$/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Completed" }).getAttribute("aria-expanded")).toBe(
      "false",
    );
  });
});
