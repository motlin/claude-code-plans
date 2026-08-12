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
import { projectsQueryOptions } from "../src/lib/api/projects";
import { activeSessionsQueryOptions, groupedSessionsQueryOptions } from "../src/lib/api/sessions";
import { installLocalStorage } from "./fake-storage";

function project(id: string, name: string, lastActivity: string) {
  return {
    id,
    name,
    projectPath: `/projects/${id}`,
    sessionCount: 1,
    memoryCount: 1,
    planCount: 0,
    taskCount: 0,
    activeCount: 0,
    lastActivity,
  };
}

function memoryList(id: string, name: string, memories: Array<[string, string, string]>) {
  return MemoryListResponse.parse({
    project: { id, name, projectPath: `/projects/${id}` },
    memories: memories.map(([filename, title, mtime]) => ({
      filename,
      title,
      mtime,
      project: id,
    })),
  });
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
  queryClient.setQueryData(
    projectMemoriesQueryOptions("alpha").queryKey,
    memoryList("alpha", "Alpha", [["alpha-notes.md", "Alpha notes", "2026-08-05T10:00:00Z"]]),
  );
  queryClient.setQueryData(
    projectMemoriesQueryOptions("beta").queryKey,
    memoryList("beta", "Beta", [["beta-notes.md", "Beta notes", "2026-08-06T10:00:00Z"]]),
  );
  queryClient.setQueryData(
    projectMemoriesQueryOptions("gamma").queryKey,
    memoryList("gamma", "Gamma", [["gamma-notes.md", "Gamma notes", "2026-08-07T10:00:00Z"]]),
  );
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

async function renderSidebar() {
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
  const memoriesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/memories",
    component: () => null,
  });
  const memoryRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/memory/$project/$filename",
    component: () => null,
  });
  const sessionRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/session/$id",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([memoriesRoute, memoryRoute, sessionRoute]),
    history: createMemoryHistory({ initialEntries: ["/memories"] }),
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

function collapseGroup(name: string) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${name}`) }));
}

afterEach(cleanup);

beforeEach(() => {
  installLocalStorage();
});

describe("sidebar memories tree", () => {
  it("keeps collapsed project groups collapsed after visiting a memory", async () => {
    const { navigate } = await renderSidebar();

    await waitFor(() => expect(screen.getByRole("button", { name: /^Alpha/ })).toBeTruthy());

    collapseGroup("Alpha");
    collapseGroup("Beta");

    expect(screen.queryByRole("link", { name: "Alpha notes" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Beta notes" })).toBeNull();

    await navigate({
      to: "/memory/$project/$filename",
      params: { project: "gamma", filename: "gamma-notes" },
    });
    await navigate({ to: "/memories" });

    await waitFor(() => expect(screen.getByRole("link", { name: "Gamma notes" })).toBeTruthy());
    expect(screen.queryByRole("link", { name: "Alpha notes" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Beta notes" })).toBeNull();
  });

  it("keeps collapsed project groups collapsed after visiting another section", async () => {
    const { navigate } = await renderSidebar();

    await waitFor(() => expect(screen.getByRole("button", { name: /^Alpha/ })).toBeTruthy());

    collapseGroup("Alpha");
    collapseGroup("Beta");

    // Opening an item in another section collapses — and unmounts — the Memories
    // section, so the collapse state has to outlive the sublist.
    await navigate({ to: "/session/$id", params: { id: "session-1" } });
    expect(screen.queryByRole("button", { name: /^Alpha/ })).toBeNull();

    await navigate({ to: "/memories" });

    await waitFor(() => expect(screen.getByRole("link", { name: "Gamma notes" })).toBeTruthy());
    expect(screen.queryByRole("link", { name: "Alpha notes" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Beta notes" })).toBeNull();
  });

  it("reveals the collapsed group holding the open memory without discarding the collapse", async () => {
    const { navigate } = await renderSidebar();

    await waitFor(() => expect(screen.getByRole("button", { name: /^Alpha/ })).toBeTruthy());

    collapseGroup("Alpha");

    await navigate({
      to: "/memory/$project/$filename",
      params: { project: "alpha", filename: "alpha-notes" },
    });
    await waitFor(() => expect(screen.getByRole("link", { name: "Alpha notes" })).toBeTruthy());

    await navigate({ to: "/memories" });

    await waitFor(() => expect(screen.getByRole("link", { name: "Gamma notes" })).toBeTruthy());
    expect(screen.queryByRole("link", { name: "Alpha notes" })).toBeNull();
  });
});
