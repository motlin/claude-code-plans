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
import { SESSION_PROJECT_PREVIEW_LIMIT } from "../src/components/session-project-groups";
import { DEFAULTS, SettingsProvider } from "../src/components/settings-provider";
import { Sidebar } from "../src/components/sidebar/Sidebar";
import { applicationSettingsQueryOptions } from "../src/lib/api/application-settings";
import { approvalsQueryOptions } from "../src/lib/api/approvals";
import { notificationsQueryOptions } from "../src/lib/api/notifications";
import { projectsQueryOptions } from "../src/lib/api/projects";
import {
  activeSessionsQueryOptions,
  groupedSessionsQueryOptions,
  GroupedSessionsResponse,
} from "../src/lib/api/sessions";
import { installLocalStorage } from "./fake-storage";

function session(id: string, title: string, project: string, mtime: string) {
  return {
    id,
    title,
    mtime,
    created: mtime,
    project,
    projectName: project,
    messageCount: 4,
    starred: false,
    state: "ended",
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
  queryClient.setQueryData(
    groupedSessionsQueryOptions().queryKey,
    GroupedSessionsResponse.parse([
      {
        project: "gamma",
        projectName: "Gamma",
        sessionCount: 7,
        sessions: [
          session("g1", "Gamma newest", "Gamma", "2026-08-07T10:00:00Z"),
          session("g2", "Gamma older", "Gamma", "2026-08-01T10:00:00Z"),
        ],
      },
      {
        project: "beta",
        projectName: "Beta",
        sessionCount: 1,
        sessions: [session("b1", "Beta only", "Beta", "2026-08-06T10:00:00Z")],
      },
      {
        project: "alpha",
        projectName: "Alpha",
        sessionCount: 1,
        sessions: [session("a1", "Alpha only", "Alpha", "2026-08-05T10:00:00Z")],
      },
    ]),
  );
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

async function renderSidebar(override?: (queryClient: QueryClient) => void) {
  const queryClient = seedQueryClient();
  override?.(queryClient);
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

describe("sidebar sessions tree", () => {
  it("groups sessions under their project, newest project first", async () => {
    await renderSidebar();

    await waitFor(() => expect(screen.getByRole("button", { name: /^Gamma/ })).toBeTruthy());

    const groupNames = screen
      .getAllByRole("button")
      .map((button) => button.textContent ?? "")
      .filter((text) => /^(Gamma|Beta|Alpha)/.test(text))
      .map((text) => text.replace(/\d+$/, ""));
    expect(groupNames).toEqual(["Gamma", "Beta", "Alpha"]);

    expect(screen.getByRole("link", { name: "Gamma newest" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Alpha only" })).toBeTruthy();
  });

  it("keeps collapsed project groups collapsed after visiting a session", async () => {
    const { navigate } = await renderSidebar();

    await waitFor(() => expect(screen.getByRole("button", { name: /^Gamma/ })).toBeTruthy());

    collapseGroup("Gamma");
    collapseGroup("Beta");

    expect(screen.queryByRole("link", { name: "Gamma newest" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Beta only" })).toBeNull();

    await navigate({ to: "/session/$id", params: { id: "a1" } });
    await navigate({ to: "/sessions" });

    await waitFor(() => expect(screen.getByRole("link", { name: "Alpha only" })).toBeTruthy());
    expect(screen.queryByRole("link", { name: "Gamma newest" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Beta only" })).toBeNull();
  });

  it("reveals the collapsed group holding the open session without discarding the collapse", async () => {
    const { navigate } = await renderSidebar();

    await waitFor(() => expect(screen.getByRole("button", { name: /^Gamma/ })).toBeTruthy());

    collapseGroup("Gamma");
    expect(screen.queryByRole("link", { name: "Gamma newest" })).toBeNull();

    await navigate({ to: "/session/$id", params: { id: "g1" } });
    await waitFor(() => expect(screen.getByRole("link", { name: "Gamma newest" })).toBeTruthy());

    await navigate({ to: "/sessions" });

    await waitFor(() => expect(screen.getByRole("link", { name: "Alpha only" })).toBeTruthy());
    expect(screen.queryByRole("link", { name: "Gamma newest" })).toBeNull();
  });

  it("links a truncated project group to the full project session list", async () => {
    await renderSidebar();

    await waitFor(() => expect(screen.getByRole("button", { name: /^Gamma/ })).toBeTruthy());

    expect(screen.getByRole("link", { name: /5 more/ })).toBeTruthy();
  });

  it("caps the tree at the most recent projects and links the rest to /sessions", async () => {
    const many = GroupedSessionsResponse.parse(
      Array.from({ length: SESSION_PROJECT_PREVIEW_LIMIT + 2 }, (_, index) => ({
        project: `p${index}`,
        projectName: `Project${index}`,
        sessionCount: 1,
        sessions: [
          session(`s${index}`, `Session ${index}`, `Project${index}`, "2026-08-07T10:00:00Z"),
        ],
      })),
    );
    await renderSidebar((queryClient) =>
      queryClient.setQueryData(groupedSessionsQueryOptions().queryKey, many),
    );

    await waitFor(() => expect(screen.getByRole("link", { name: "Session 0" })).toBeTruthy());

    expect(screen.getByRole("link", { name: "Session 9" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Session 10" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Session 11" })).toBeNull();
    const more = screen.getByRole("link", { name: /2 more projects/ });
    expect(more.getAttribute("href")).toBe("/sessions");
  });
});
