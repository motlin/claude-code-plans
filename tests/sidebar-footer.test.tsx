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
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { DEFAULTS, SettingsProvider } from "../src/components/settings-provider";
import { Sidebar } from "../src/components/sidebar/Sidebar";
import { useCommandPalette } from "../src/hooks/use-command-palette";
import { applicationSettingsQueryOptions } from "../src/lib/api/application-settings";
import { approvalsQueryOptions } from "../src/lib/api/approvals";
import { localUserQueryOptions } from "../src/lib/api/local-user";
import { notificationsQueryOptions } from "../src/lib/api/notifications";
import { activeSessionsQueryOptions } from "../src/lib/api/sessions";
import { installLocalStorage } from "./fake-storage";
import { NAV_SECTIONS } from "../src/lib/nav-sections";
import { ToastProvider } from "../src/components/toast";

function PaletteProbe() {
  const palette = useCommandPalette();
  return (
    <div data-testid="palette-probe">
      {palette.open ? "open" : "closed"}:{palette.entrypoint}
    </div>
  );
}

function seedQueryClient(username: string | null): QueryClient {
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
    herdrWritesEnabled: false,
    visibleNavSections: NAV_SECTIONS.filter((section) => section !== "herdr" && section !== "tmux"),
    ignoredDirs: ["node_modules"],
  });
  queryClient.setQueryData(localUserQueryOptions.queryKey, { username });
  return queryClient;
}

async function renderSidebar(username: string | null = "craig") {
  const queryClient = seedQueryClient(username);
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <SettingsProvider>
            <Sidebar collapsed={false} />
            <PaletteProbe />
            <Outlet />
          </SettingsProvider>
        </ToastProvider>
      </QueryClientProvider>
    ),
  });
  const searchRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/search",
    component: () => <div data-testid="search-page" />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([searchRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return router;
}

afterEach(cleanup);

beforeEach(() => {
  installLocalStorage();
});

describe("sidebar footer", () => {
  it("renders the account button linking to settings and the Search icon button", async () => {
    await renderSidebar();

    const footer = await waitFor(() => screen.getByTestId("sidebar-footer"));
    const account = within(footer).getByTestId("user-menu-button");
    const search = within(footer).getByRole("button", { name: "Search" });

    expect({
      accountText: account.textContent,
      accountHref: account.getAttribute("href"),
      buttonNames: within(footer)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
      searchKeys: search.getAttribute("aria-keyshortcuts"),
    }).toStrictEqual({
      accountText: "Ccraig",
      accountHref: "/settings",
      buttonNames: ["Search"],
      searchKeys: "Control+Shift+k",
    });
  });

  it("labels the account button Local when the OS username is unknown", async () => {
    await renderSidebar(null);

    const account = await waitFor(() => screen.getByTestId("user-menu-button"));

    expect(account.textContent).toBe("LLocal");
  });

  it("opens the palette in Search mode from the footer Search button", async () => {
    const router = await renderSidebar();

    const search = await waitFor(() => screen.getByRole("button", { name: "Search" }));
    fireEvent.click(search);

    await waitFor(() =>
      expect(screen.getByTestId("palette-probe").textContent).toBe("open:search"),
    );
    expect(router.state.location.pathname).toBe("/");
  });

  it("has no inline search input and no feedback button", async () => {
    await renderSidebar();
    await waitFor(() => screen.getByTestId("sidebar-footer"));

    expect({
      textboxes: screen.queryAllByRole("textbox").length,
      feedback: screen.queryAllByRole("button", { name: /feedback/i }).length,
    }).toStrictEqual({ textboxes: 0, feedback: 0 });
  });
});
