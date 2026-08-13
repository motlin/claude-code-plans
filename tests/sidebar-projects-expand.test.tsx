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
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { DEFAULTS, SettingsProvider } from "../src/components/settings-provider";
import { Sidebar } from "../src/components/sidebar/Sidebar";
import { applicationSettingsQueryOptions } from "../src/lib/api/application-settings";
import { approvalsQueryOptions } from "../src/lib/api/approvals";
import { MemoryListResponse, projectMemoriesQueryOptions } from "../src/lib/api/memories";
import { notificationsQueryOptions } from "../src/lib/api/notifications";
import {
  projectBranchesQueryOptions,
  projectPlansQueryOptions,
  projectSessionsQueryOptions,
  projectsQueryOptions,
  projectTasksQueryOptions,
} from "../src/lib/api/projects";
import { activeSessionsQueryOptions, groupedSessionsQueryOptions } from "../src/lib/api/sessions";
import { installLocalStorage } from "./fake-storage";

function project(id: string, name: string, lastActivity: string) {
  return {
    id,
    name,
    projectPath: `/projects/${id}`,
    sessionCount: 1,
    memoryCount: 0,
    planCount: 0,
    taskCount: 0,
    activeCount: 0,
    lastActivity,
  };
}

function seedProjectDetail(queryClient: QueryClient, id: string, name: string) {
  queryClient.setQueryData(projectSessionsQueryOptions(id).queryKey, [
    {
      id: `${id}-session`,
      title: `${name} session`,
      mtime: "2026-08-05T10:00:00Z",
      created: "2026-08-05T09:00:00Z",
      messageCount: 2,
      subagentCount: 0,
    },
  ]);
  queryClient.setQueryData(projectPlansQueryOptions(id).queryKey, []);
  queryClient.setQueryData(projectBranchesQueryOptions(id).queryKey, []);
  queryClient.setQueryData(projectTasksQueryOptions(id).queryKey, {
    todos: [],
    todoCounts: { total: 0, pending: 0, inProgress: 0, completed: 0 },
  });
  queryClient.setQueryData(
    projectMemoriesQueryOptions(id).queryKey,
    MemoryListResponse.parse({
      project: { id, name, projectPath: `/projects/${id}` },
      memories: [],
    }),
  );
}

function seedQueryClient(): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity, refetchOnMount: false },
    },
  });
  queryClient.setQueryData(projectsQueryOptions().queryKey, [
    project("alpha", "Alpha", "2026-08-05T10:00:00Z"),
    project("beta", "Beta", "2026-08-06T10:00:00Z"),
    project("gamma", "Gamma", "2026-08-07T10:00:00Z"),
  ]);
  seedProjectDetail(queryClient, "alpha", "Alpha");
  seedProjectDetail(queryClient, "beta", "Beta");
  seedProjectDetail(queryClient, "gamma", "Gamma");
  queryClient.setQueryData(groupedSessionsQueryOptions().queryKey, []);
  queryClient.setQueryData(approvalsQueryOptions().queryKey, { approvals: [] });
  queryClient.setQueryData(notificationsQueryOptions().queryKey, { notifications: [] });
  queryClient.setQueryData(
    activeSessionsQueryOptions(DEFAULTS.activeTimeoutSec * 1000).queryKey,
    [],
  );
  queryClient.setQueryData(applicationSettingsQueryOptions.queryKey, {
    herdrWritesEnabled: false,
    showHerdrSection: false,
    showTmuxSection: false,
    ignoredDirs: ["node_modules"],
  });
  return queryClient;
}

async function renderSidebar(initialPath = "/projects") {
  const queryClient = seedQueryClient();
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <SettingsProvider>
          <Sidebar collapsed={false} onToggle={() => {}} />
          <Outlet />
        </SettingsProvider>
      </QueryClientProvider>
    ),
  });
  const projectsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/projects",
    component: () => null,
  });
  const projectRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/project/$id",
    component: () => null,
  });
  const sessionRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/session/$id",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([projectsRoute, projectRoute, sessionRoute]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return {
    navigate: async (options: { to: string; params?: Record<string, string> }) => {
      await act(async () => {
        await router.navigate(options as never);
      });
    },
  };
}

function toggleProject(name: string) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^(Expand|Collapse) ${name}$`) }));
}

afterEach(cleanup);

beforeEach(() => {
  installLocalStorage();
});

describe("sidebar projects tree", () => {
  it("keeps expanded projects expanded after visiting another section", async () => {
    const { navigate } = await renderSidebar();

    await waitFor(() => expect(screen.getByRole("button", { name: "Expand Alpha" })).toBeTruthy());

    toggleProject("Alpha");
    toggleProject("Beta");

    await waitFor(() => expect(screen.getByRole("link", { name: "Alpha session" })).toBeTruthy());
    expect(screen.getByRole("link", { name: "Beta session" })).toBeTruthy();

    // Opening an item in another section collapses — and unmounts — the Projects
    // section, so the expansion state has to outlive the sublist.
    await navigate({ to: "/session/$id", params: { id: "session-1" } });
    expect(screen.queryByRole("button", { name: /Alpha$/ })).toBeNull();

    await navigate({ to: "/projects" });

    await waitFor(() => expect(screen.getByRole("link", { name: "Alpha session" })).toBeTruthy());
    expect(screen.getByRole("link", { name: "Beta session" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Gamma session" })).toBeNull();
  });

  it("auto-expands the project being viewed", async () => {
    await renderSidebar("/project/gamma");

    await waitFor(() => expect(screen.getByRole("link", { name: "Gamma session" })).toBeTruthy());
    expect(screen.queryByRole("link", { name: "Alpha session" })).toBeNull();
  });

  it("lets the auto-expanded project be collapsed again", async () => {
    await renderSidebar("/project/gamma");

    await waitFor(() => expect(screen.getByRole("link", { name: "Gamma session" })).toBeTruthy());

    toggleProject("Gamma");

    await waitFor(() => expect(screen.queryByRole("link", { name: "Gamma session" })).toBeNull());
  });
});
