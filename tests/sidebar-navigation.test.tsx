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
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { DEFAULTS, SettingsProvider } from "../src/components/settings-provider";
import { useActiveSection } from "../src/components/sidebar/hooks";
import { navItems } from "../src/components/sidebar/navigation";
import { Sidebar } from "../src/components/sidebar/Sidebar";
import { applicationSettingsQueryOptions } from "../src/lib/api/application-settings";
import { approvalsQueryOptions } from "../src/lib/api/approvals";
import { notificationsQueryOptions } from "../src/lib/api/notifications";
import { activeSessionsQueryOptions } from "../src/lib/api/sessions";
import { installLocalStorage } from "./fake-storage";

function seedQueryClient(): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity, refetchOnMount: false },
    },
  });
  queryClient.setQueryData(approvalsQueryOptions().queryKey, {
    approvals: [
      {
        sessionId: "session-test-200",
        projectId: "project-test-200",
        projectName: "project-test-200",
        toolName: "ExitPlanMode",
        toolUseId: "tool-use-test-200",
        blockedSince: "2026-01-01T00:00:00.000Z",
        planFilename: null,
        questionPreview: null,
      },
    ],
  });
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

async function renderSidebarAt(path: string) {
  const queryClient = seedQueryClient();
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <SettingsProvider>
          <Sidebar collapsed={false} />
          <Outlet />
        </SettingsProvider>
      </QueryClientProvider>
    ),
  });
  const pageRoute = createRoute({ getParentRoute: () => rootRoute, path });
  const router = createRouter({
    routeTree: rootRoute.addChildren([pageRoute]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
}

afterEach(cleanup);

beforeEach(() => {
  installLocalStorage();
});

describe("sidebar navigation", () => {
  it("links to each top-level section", () => {
    expect(navItems.map(({ label, to }) => ({ label, to }))).toStrictEqual([
      { label: "Active", to: "/active" },
      { label: "Herdr", to: "/herdr" },
      { label: "Tmux Windows", to: "/tmux" },
      { label: "Approvals", to: "/approvals" },
      { label: "Notifications", to: "/notifications" },
      { label: "Starred", to: "/starred" },
      { label: "Tasks", to: "/tasks" },
      { label: "Projects", to: "/projects" },
      { label: "Plans", to: "/plans" },
      { label: "Memories", to: "/memories" },
      { label: "Sessions", to: "/sessions" },
      { label: "Plugins", to: "/plugins" },
      { label: "Settings", to: "/settings" },
      { label: "Claude Config", to: "/settings/edit" },
      { label: "Setup", to: "/setup" },
    ]);
  });

  it("activates the tmux section on the tmux route", () => {
    const matches = [{ fullPath: "/tmux", params: {} }] as unknown as Parameters<
      typeof useActiveSection
    >[0];

    expect(useActiveSection(matches)).toStrictEqual({ section: "tmux", activeItemId: null });
  });

  it("activates the Herdr section and terminal on a live terminal route", () => {
    const matches = [
      { fullPath: "/herdr/terminal/$sessionId", params: { sessionId: "session-test-100" } },
    ] as unknown as Parameters<typeof useActiveSection>[0];

    expect(useActiveSection(matches)).toStrictEqual({
      section: "herdr",
      activeItemId: "session-test-100",
    });
  });
});

describe("sidebar nav rows", () => {
  function navRows(): HTMLElement[] {
    return screen
      .getAllByRole("link")
      .filter((link) => navItems.some((item) => item.to === link.getAttribute("href")));
  }

  it("uses the upstream row recipe on every nav link", async () => {
    await renderSidebarAt("/starred");
    await waitFor(() => screen.getByRole("link", { name: "Starred" }));

    const rows = navRows();
    expect(rows.length).toBeGreaterThan(0);
    expect(
      rows.map((row) => ({
        href: row.getAttribute("href"),
        height: row.classList.contains("h-[var(--sb-row-h)]"),
        radius: row.classList.contains("rounded-[var(--sb-radius)]"),
        leadingSlot: row.querySelector(":scope > .df-leading-slot > svg") !== null,
      })),
    ).toStrictEqual(
      rows.map((row) => ({
        href: row.getAttribute("href"),
        height: true,
        radius: true,
        leadingSlot: true,
      })),
    );
  });

  it("marks only the active row as focused", async () => {
    await renderSidebarAt("/starred");
    await waitFor(() => screen.getByRole("link", { name: "Starred" }));

    expect(
      navRows()
        .filter((row) => row.hasAttribute("data-selected"))
        .map((row) => ({
          href: row.getAttribute("href"),
          selected: row.getAttribute("data-selected"),
        })),
    ).toStrictEqual([{ href: "/starred", selected: "focused" }]);
  });

  it("renders count badges inside the trailing slot", async () => {
    await renderSidebarAt("/starred");
    const approvals = await waitFor(() => screen.getByRole("link", { name: /Approvals/ }));

    const tail = approvals.querySelector(":scope > .df-tail-mark");
    expect({
      text: tail?.textContent,
      badgeTitle: tail
        ? within(tail as HTMLElement).getByTitle("1 awaiting approval").textContent
        : null,
    }).toStrictEqual({ text: "1", badgeTitle: "1" });
  });
});
