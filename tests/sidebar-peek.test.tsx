// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
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
import { notificationsQueryOptions } from "../src/lib/api/notifications";
import { activeSessionsQueryOptions } from "../src/lib/api/sessions";
import { readSidebarState, useSidebarState, writeSidebarState } from "../src/lib/sidebar-store";
import { installLocalStorage } from "./fake-storage";
import { NAV_SECTIONS } from "../src/lib/nav-sections";
import { ToastProvider } from "../src/components/toast";

function seedQueryClient(): QueryClient {
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
  return queryClient;
}

function PersistedSidebar() {
  const { collapsed } = useSidebarState();
  return <Sidebar collapsed={collapsed} />;
}

async function renderCollapsedSidebar() {
  writeSidebarState({ ...readSidebarState(), collapsed: true });
  const queryClient = seedQueryClient();
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <SettingsProvider>
            <PersistedSidebar />
            <Outlet />
          </SettingsProvider>
        </ToastProvider>
      </QueryClientProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return waitFor(() => screen.getByRole("button", { name: "Show sidebar" }));
}

afterEach(cleanup);

beforeEach(() => {
  installLocalStorage();
});

describe("collapsed sidebar peek", () => {
  it("shows the popover while the trigger is hovered and hides it after leaving", async () => {
    const trigger = await renderCollapsedSidebar();
    const root = screen.getByTestId("sidebar-collapsed");
    const peek = screen.getByTestId("sidebar-peek");

    expect({
      hovering: root.hasAttribute("data-hovering"),
      ariaHidden: peek.getAttribute("aria-hidden"),
      inert: peek.hasAttribute("inert"),
    }).toEqual({ hovering: false, ariaHidden: "true", inert: true });

    act(() => {
      fireEvent.pointerEnter(trigger);
    });
    expect({
      hovering: root.hasAttribute("data-hovering"),
      ariaHidden: peek.getAttribute("aria-hidden"),
      inert: peek.hasAttribute("inert"),
      nav: screen.getByRole("navigation", { name: "Sidebar" }) === peek,
    }).toEqual({ hovering: true, ariaHidden: null, inert: false, nav: true });

    act(() => {
      fireEvent.pointerLeave(trigger);
    });
    expect({
      hovering: root.hasAttribute("data-hovering"),
      ariaHidden: peek.getAttribute("aria-hidden"),
    }).toEqual({ hovering: false, ariaHidden: "true" });
  });

  it("keeps the peek open while the pointer moves across the bridge into the popover", async () => {
    const trigger = await renderCollapsedSidebar();
    const root = screen.getByTestId("sidebar-collapsed");
    const bridge = screen.getByTestId("sidebar-peek-bridge");
    const peek = screen.getByTestId("sidebar-peek");

    act(() => {
      fireEvent.pointerEnter(trigger);
    });
    act(() => {
      fireEvent.pointerOut(trigger, { relatedTarget: bridge });
      fireEvent.pointerOver(bridge, { relatedTarget: trigger });
    });
    act(() => {
      fireEvent.pointerOut(bridge, { relatedTarget: peek });
      fireEvent.pointerOver(peek, { relatedTarget: bridge });
    });
    expect(root.hasAttribute("data-hovering")).toBe(true);

    act(() => {
      fireEvent.pointerLeave(peek);
    });
    expect(root.hasAttribute("data-hovering")).toBe(false);
  });

  it("expands and persists when Enter is pressed on the focused trigger", async () => {
    const trigger = await renderCollapsedSidebar();
    trigger.focus();

    act(() => {
      fireEvent.keyDown(trigger, { key: "Enter", code: "Enter" });
    });

    expect(readSidebarState().collapsed).toBe(false);
    expect(screen.getByRole("button", { name: "Hide sidebar" }).tagName).toBe("BUTTON");
    expect(screen.queryByTestId("sidebar-collapsed")).toBe(null);
  });
});
