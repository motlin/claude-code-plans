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
import { DEFAULTS, SettingsProvider } from "../src/components/settings-provider";
import { Sidebar } from "../src/components/sidebar/Sidebar";
import { applicationSettingsQueryOptions } from "../src/lib/api/application-settings";
import { approvalsQueryOptions } from "../src/lib/api/approvals";
import { notificationsQueryOptions } from "../src/lib/api/notifications";
import { activeSessionsQueryOptions } from "../src/lib/api/sessions";
import type { NavSection } from "../src/lib/nav-sections";
import { ToastProvider } from "../src/components/toast";
import { installLocalStorage } from "./fake-storage";

const BASE_SETTINGS = {
  herdrWritesEnabled: false,
  shellPaneEnabled: true,
  ignoredDirs: ["node_modules"],
};

function seedQueryClient(visibleNavSections: NavSection[]): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity, refetchOnMount: false },
    },
  });
  queryClient.setQueryData(approvalsQueryOptions().queryKey, { approvals: [] });
  queryClient.setQueryData(notificationsQueryOptions().queryKey, { notifications: [] });
  queryClient.setQueryData(
    activeSessionsQueryOptions(DEFAULTS.activeTimeoutSec * 1000).queryKey,
    [],
  );
  queryClient.setQueryData(applicationSettingsQueryOptions.queryKey, {
    ...BASE_SETTINGS,
    visibleNavSections,
  });
  return queryClient;
}

const puts: unknown[] = [];

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/application-settings" && init?.method === "PUT") {
        const body: unknown = JSON.parse(String(init.body));
        puts.push(body);
        return Promise.resolve(Response.json(body));
      }
      return new Promise<Response>(() => {});
    }),
  );
}

async function renderSidebar(
  visibleNavSections: NavSection[] = ["artifacts", "plans", "memories", "customize"],
) {
  const queryClient = seedQueryClient(visibleNavSections);
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <SettingsProvider>
            <Sidebar collapsed={false} />
            <Outlet />
          </SettingsProvider>
        </ToastProvider>
      </QueryClientProvider>
    ),
  });
  const pageRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "$",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([pageRoute]),
    history: createMemoryHistory({ initialEntries: ["/plans"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  await screen.findByRole("link", { name: "Plans" });
  return { router, queryClient };
}

function sidebarNavLabels(): string[] {
  // An open modal dialog marks the sidebar itself aria-hidden (the toast live region keeps
  // its parent exposed), which also blanks its accessible name, so match the label directly.
  const sidebar = screen
    .getAllByRole("navigation", { hidden: true })
    .find((nav) => nav.getAttribute("aria-label") === "Sidebar");
  if (sidebar === undefined) throw new Error("no Sidebar navigation");
  const footer = screen.getByTestId("sidebar-footer");
  return within(sidebar)
    .getAllByRole("link", { hidden: true })
    .filter((link) => !footer.contains(link) && link.getAttribute("href") !== "/")
    .map((link) => link.textContent ?? "");
}

async function openMoreMenu(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("button", { name: "More navigation items" }));
  return screen.findByRole("menu");
}

async function openEditSidebar(): Promise<HTMLElement> {
  const menu = await openMoreMenu();
  fireEvent.click(within(menu).getByRole("menuitem", { name: "Edit sidebar…" }));
  return screen.findByRole("dialog", { name: "Edit sidebar" });
}

beforeEach(() => {
  installLocalStorage();
  puts.length = 0;
  stubFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("sidebar More menu", () => {
  it("shows only the pinned sections as sidebar rows", async () => {
    await renderSidebar();

    expect(sidebarNavLabels()).toStrictEqual([
      "Artifacts",
      "Plans",
      "Memories",
      "Sessions",
      "Customize",
    ]);
  });

  it("lists hidden sections, a separator, then Edit sidebar…", async () => {
    await renderSidebar();
    const menu = await openMoreMenu();

    expect({
      items: within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
      separators: within(menu).getAllByRole("separator").length,
    }).toStrictEqual({
      items: [
        "Routines",
        "Active",
        "Herdr",
        "Tmux Windows",
        "Approvals",
        "Notifications",
        "Tasks",
        "Projects",
        "Edit sidebar…",
      ],
      separators: 1,
    });
  });

  it("navigates when a hidden section is selected", async () => {
    const { router } = await renderSidebar();
    const menu = await openMoreMenu();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Tasks" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/tasks"));
  });
});

describe("Edit sidebar dialog", () => {
  it("lists every toggleable section with its current visibility", async () => {
    await renderSidebar();
    const dialog = await openEditSidebar();

    expect(
      within(dialog)
        .getAllByRole("checkbox")
        .map((checkbox) => ({
          label: checkbox.textContent,
          checked: checkbox.getAttribute("aria-checked"),
        })),
    ).toStrictEqual([
      { label: "Artifacts", checked: "true" },
      { label: "Routines", checked: "false" },
      { label: "Active", checked: "false" },
      { label: "Herdr", checked: "false" },
      { label: "Tmux Windows", checked: "false" },
      { label: "Approvals", checked: "false" },
      { label: "Notifications", checked: "false" },
      { label: "Tasks", checked: "false" },
      { label: "Projects", checked: "false" },
      { label: "Plans", checked: "true" },
      { label: "Memories", checked: "true" },
      { label: "Customize", checked: "true" },
    ]);
  });

  it("persists each toggle and updates the sidebar", async () => {
    await renderSidebar();
    const dialog = await openEditSidebar();

    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Herdr" }));
    await waitFor(() => expect(sidebarNavLabels()).toContain("Herdr"));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Memories" }));
    await waitFor(() => expect(puts).toHaveLength(2));

    expect({ puts, sidebar: sidebarNavLabels() }).toStrictEqual({
      puts: [
        {
          ...BASE_SETTINGS,
          visibleNavSections: ["artifacts", "herdr", "plans", "memories", "customize"],
        },
        { ...BASE_SETTINGS, visibleNavSections: ["artifacts", "herdr", "plans", "customize"] },
      ],
      sidebar: ["Artifacts", "Herdr", "Plans", "Sessions", "Customize"],
    });
  });

  it("closes on Done", async () => {
    await renderSidebar();
    const dialog = await openEditSidebar();

    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("closes on Escape", async () => {
    await renderSidebar();
    const dialog = await openEditSidebar();

    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
