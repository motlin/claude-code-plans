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
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { AppFrame } from "../src/components/app-frame";
import { DEFAULTS, SettingsProvider } from "../src/components/settings-provider";
import { ToastProvider } from "../src/components/toast";
import { applicationSettingsQueryOptions } from "../src/lib/api/application-settings";
import { approvalsQueryOptions } from "../src/lib/api/approvals";
import { notificationsQueryOptions } from "../src/lib/api/notifications";
import { activeSessionsQueryOptions } from "../src/lib/api/sessions";
import { NAV_SECTIONS } from "../src/lib/nav-sections";
import {
  readSidebarState,
  SIDEBAR_STORAGE_KEY,
  useSidebarState,
  writeSidebarState,
} from "../src/lib/sidebar-store";
import { NARROW_VIEWPORT_QUERY, PHONE_SHEET_QUERY } from "../src/lib/use-phone-sheet";
import { installLocalStorage } from "./fake-storage";

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
    shellPaneEnabled: true,
    visibleNavSections: NAV_SECTIONS.filter((section) => section !== "herdr" && section !== "tmux"),
    ignoredDirs: ["node_modules"],
  });
  return queryClient;
}

function mockViewport(width: number) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches:
        query === PHONE_SHEET_QUERY
          ? width < 640
          : query === NARROW_VIEWPORT_QUERY
            ? width < 768
            : false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })),
  );
}

function PersistedFrame() {
  const { collapsed } = useSidebarState();
  return (
    <AppFrame collapsed={collapsed}>
      <Outlet />
    </AppFrame>
  );
}

async function renderFrame() {
  const queryClient = seedQueryClient();
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <SettingsProvider>
            <PersistedFrame />
          </SettingsProvider>
        </ToastProvider>
      </QueryClientProvider>
    ),
  });
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <p>Home page</p>,
  });
  const otherRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/plans",
    component: () => <p>Other page</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([homeRoute, otherRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  const view = render(<RouterProvider router={router} />);
  await waitFor(() => screen.getByText("Home page"));
  return { router, container: view.container };
}

function frameRoot(container: HTMLElement): HTMLElement {
  const root = container.querySelector<HTMLElement>("[data-testid='app-frame']");
  if (!root) throw new Error("app frame not rendered");
  return root;
}

function sheet(): HTMLElement {
  const element = document.getElementById("sidebar-sheet");
  if (!element) throw new Error("sheet not rendered");
  return element;
}

function mainElement(container: HTMLElement): HTMLElement {
  const element = container.querySelector("main");
  if (!element) throw new Error("main not rendered");
  return element;
}

async function openSheet() {
  const trigger = screen.getByRole("button", { name: "Show sidebar" });
  fireEvent.click(trigger);
  await waitFor(() => expect(sheet().hasAttribute("data-open")).toBe(true));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  installLocalStorage();
});

describe("phone sheet sidebar", () => {
  it("marks the root and renders a closed modal sheet under 640px", async () => {
    mockViewport(390);
    const { container } = await renderFrame();

    expect(frameRoot(container).getAttribute("data-phone-sheet")).toBe("left");
    const trigger = screen.getByRole("button", { name: "Show sidebar" });
    expect({
      expanded: trigger.getAttribute("aria-expanded"),
      controls: trigger.getAttribute("aria-controls"),
    }).toStrictEqual({ expanded: "false", controls: "sidebar-sheet" });
    expect({
      role: sheet().getAttribute("role"),
      modal: sheet().getAttribute("aria-modal"),
      open: sheet().hasAttribute("data-open"),
      inert: sheet().hasAttribute("inert"),
    }).toStrictEqual({ role: "dialog", modal: "true", open: false, inert: true });
    expect(mainElement(container).hasAttribute("inert")).toBe(false);
  });

  it("opens from the trigger, focuses Close and makes main inert", async () => {
    mockViewport(390);
    const { container } = await renderFrame();

    await openSheet();

    const close = screen.getByRole("button", { name: "Close sidebar" });
    expect({
      expanded: screen.getByRole("button", { name: "Show sidebar" }).getAttribute("aria-expanded"),
      mainInert: mainElement(container).hasAttribute("inert"),
      sheetInert: sheet().hasAttribute("inert"),
      closeMarked: close.hasAttribute("data-phone-sheet-close"),
      focused: document.activeElement === close,
    }).toStrictEqual({
      expanded: "true",
      mainInert: true,
      sheetInert: false,
      closeMarked: true,
      focused: true,
    });
  });

  it("closes on Escape", async () => {
    mockViewport(390);
    const { container } = await renderFrame();
    await openSheet();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(sheet().hasAttribute("data-open")).toBe(false));
    expect(mainElement(container).hasAttribute("inert")).toBe(false);
  });

  it("closes from the Close button", async () => {
    mockViewport(390);
    const { container } = await renderFrame();
    await openSheet();

    fireEvent.click(screen.getByRole("button", { name: "Close sidebar" }));

    await waitFor(() => expect(sheet().hasAttribute("data-open")).toBe(false));
    expect(mainElement(container).hasAttribute("inert")).toBe(false);
  });

  it("closes when the route changes", async () => {
    mockViewport(390);
    const { router } = await renderFrame();
    await openSheet();

    await act(() => router.navigate({ to: "/plans" }));

    await waitFor(() => screen.getByText("Other page"));
    expect(sheet().hasAttribute("data-open")).toBe(false);
  });

  it("closes on browser Back (popstate)", async () => {
    mockViewport(390);
    await renderFrame();
    await openSheet();

    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    await waitFor(() => expect(sheet().hasAttribute("data-open")).toBe(false));
  });

  it("does not render the sheet at 640px and wider", async () => {
    mockViewport(640);
    const { container } = await renderFrame();

    expect({
      phoneSheet: frameRoot(container).hasAttribute("data-phone-sheet"),
      sheet: document.getElementById("sidebar-sheet"),
    }).toStrictEqual({ phoneSheet: false, sheet: null });
  });
});

describe("narrow viewport forced collapse", () => {
  it("renders collapsed between 640 and 767px without touching the stored preference", async () => {
    mockViewport(700);
    writeSidebarState({ ...readSidebarState(), collapsed: false });
    const storedBefore = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    const { container } = await renderFrame();

    const trigger = screen.getByRole("button", { name: "Show sidebar" });
    expect({
      phoneSheet: frameRoot(container).hasAttribute("data-phone-sheet"),
      collapsed: screen.queryByTestId("sidebar-collapsed") !== null,
      hide: screen.queryByRole("button", { name: "Hide sidebar" }),
      shortcut: trigger.getAttribute("aria-keyshortcuts"),
      stored: window.localStorage.getItem(SIDEBAR_STORAGE_KEY),
      storedCollapsed: readSidebarState().collapsed,
    }).toStrictEqual({
      phoneSheet: false,
      collapsed: true,
      hide: null,
      shortcut: null,
      stored: storedBefore,
      storedCollapsed: false,
    });
  });

  it("opens the peek from a trigger click instead of changing the stored preference", async () => {
    mockViewport(700);
    writeSidebarState({ ...readSidebarState(), collapsed: false });
    const storedBefore = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    await renderFrame();

    fireEvent.click(screen.getByRole("button", { name: "Show sidebar" }));

    expect({
      hovering: screen.getByTestId("sidebar-collapsed").hasAttribute("data-hovering"),
      stored: window.localStorage.getItem(SIDEBAR_STORAGE_KEY),
    }).toStrictEqual({ hovering: true, stored: storedBefore });
  });

  it("keeps the peek open after hover plus click and closes it on an outside press", async () => {
    mockViewport(700);
    const { container } = await renderFrame();
    const trigger = screen.getByRole("button", { name: "Show sidebar" });
    const root = screen.getByTestId("sidebar-collapsed");

    act(() => {
      fireEvent.pointerEnter(trigger);
    });
    fireEvent.click(trigger);
    const afterClick = root.hasAttribute("data-hovering");

    act(() => {
      fireEvent.pointerDown(mainElement(container));
    });

    expect({ afterClick, afterOutside: root.hasAttribute("data-hovering") }).toStrictEqual({
      afterClick: true,
      afterOutside: false,
    });
  });

  it("docks the expanded sidebar at 768px and wider", async () => {
    mockViewport(768);
    writeSidebarState({ ...readSidebarState(), collapsed: false });
    await renderFrame();

    expect({
      collapsed: screen.queryByTestId("sidebar-collapsed"),
      hide: screen.getByRole("button", { name: "Hide sidebar" }).tagName,
    }).toStrictEqual({ collapsed: null, hide: "BUTTON" });
  });
});
