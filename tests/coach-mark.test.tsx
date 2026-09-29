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
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { CoachMark } from "../src/components/coach-mark";
import { SettingsProvider, settingStorageKey } from "../src/components/settings-provider";
import { SessionGroups } from "../src/components/sidebar/session-groups";
import { ToastProvider } from "../src/components/toast";
import {
  RecentSessionsResponse,
  recentSessionsInfiniteQueryOptions,
} from "../src/lib/api/sessions";
import { closeDragPinHint } from "../src/lib/drag-pin-hint";
import { readPinState } from "../src/lib/pin-store";
import type { SessionBucket } from "../src/lib/session-state";
import { SIDEBAR_STORAGE_KEY, DEFAULT_SIDEBAR_STATE } from "../src/lib/sidebar-store";
import { installLocalStorage } from "./fake-storage";

const HINT = "Tip: you can drag sessions here to pin them";
const SEEN_KEY = settingStorageKey("seenDragPinHint");
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
  session("r1", "Review one", "review", 2),
  session("d2", "Completed older", "done", 30),
];

async function renderSidebar() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity, refetchOnMount: false },
    },
  });
  queryClient.setQueryData(recentSessionsInfiniteQueryOptions().queryKey, {
    pages: [RecentSessionsResponse.parse({ sessions: FIXTURE, nextCursor: null })],
    pageParams: [null],
  });
  const rootRoute = createRootRoute({
    component: () => (
      <SettingsProvider>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <SessionGroups activeItemId={null} />
            <button type="button">Outside</button>
            <Outlet />
          </ToastProvider>
        </QueryClientProvider>
      </SettingsProvider>
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

async function tick(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function menuPin(title: string): Promise<void> {
  fireEvent.contextMenu(screen.getByText(title), { clientX: 40, clientY: 50 });
  await tick();
  const item = [
    ...screen.getByRole("menu").querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ].find((candidate) => (candidate.firstChild?.textContent ?? "").trim() === "Pin");
  if (item === undefined) throw new Error("no Pin item");
  fireEvent.click(item);
  await tick();
}

function hint(): HTMLElement | null {
  return screen.queryByRole("dialog", { name: HINT });
}

function clickOutside(): void {
  const outside = screen.getByRole("button", { name: "Outside" });
  fireEvent.pointerDown(outside);
  fireEvent.mouseDown(outside);
  fireEvent.pointerUp(outside);
  fireEvent.mouseUp(outside);
  fireEvent.click(outside);
}

afterEach(() => {
  cleanup();
  closeDragPinHint();
  vi.restoreAllMocks();
});

beforeEach(() => {
  installLocalStorage();
});

describe("CoachMark", () => {
  function Harness({ onDismiss, onClose }: { onDismiss: () => void; onClose: () => void }) {
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    return (
      <>
        <div ref={setAnchor}>Anchor</div>
        <button type="button">Outside</button>
        <CoachMark
          open
          anchor={anchor}
          message="Tip text"
          onDismiss={onDismiss}
          onClose={onClose}
        />
      </>
    );
  }

  it("renders an accent tip with a Dismiss button that dismisses", async () => {
    const onDismiss = vi.fn();
    const onClose = vi.fn();
    render(<Harness onDismiss={onDismiss} onClose={onClose} />);
    await tick();

    const dialog = await screen.findByRole("dialog", { name: "Tip text" });
    expect({
      variant: dialog.getAttribute("data-variant"),
      text: dialog.textContent,
    }).toStrictEqual({ variant: "accent", text: "Tip text" });

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect({
      dismiss: onDismiss.mock.calls.length,
      close: onClose.mock.calls.length,
    }).toStrictEqual({ dismiss: 1, close: 0 });
  });

  it("dismisses on Escape and only closes on an outside click", async () => {
    const onDismiss = vi.fn();
    const onClose = vi.fn();
    render(<Harness onDismiss={onDismiss} onClose={onClose} />);
    await screen.findByRole("dialog", { name: "Tip text" });

    clickOutside();
    expect({
      dismiss: onDismiss.mock.calls.length,
      close: onClose.mock.calls.length,
    }).toStrictEqual({ dismiss: 0, close: 1 });

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect({
      dismiss: onDismiss.mock.calls.length,
      close: onClose.mock.calls.length,
    }).toStrictEqual({ dismiss: 1, close: 1 });
  });
});

describe("drag-to-pin coach mark", () => {
  it("shows after the first menu pin, revealing the idle drop row", async () => {
    const { container } = await renderSidebar();
    expect(hint()).toBeNull();

    await menuPin("Review one");

    await waitFor(() => expect(hint()).not.toBeNull());
    expect(container.querySelector("[data-pin-drop-row]")?.textContent).toBe("Drag to pin");
  });

  it("is shown once: Dismiss persists the flag and later menu pins stay quiet", async () => {
    const { container } = await renderSidebar();
    await menuPin("Review one");
    await waitFor(() => expect(hint()).not.toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(hint()).toBeNull());
    expect(localStorage.getItem(SEEN_KEY)).toBe("true");
    expect(container.querySelector("[data-pin-drop-row]")).toBeNull();

    await menuPin("Completed older");
    expect(hint()).toBeNull();
  });

  it("Escape marks the hint seen", async () => {
    await renderSidebar();
    await menuPin("Review one");
    await waitFor(() => expect(hint()).not.toBeNull());

    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(hint()).toBeNull());
    expect(localStorage.getItem(SEEN_KEY)).toBe("true");
  });

  it("an outside click closes it without marking it seen, so the next menu pin shows it again", async () => {
    await renderSidebar();
    await menuPin("Review one");
    await waitFor(() => expect(hint()).not.toBeNull());

    clickOutside();
    await waitFor(() => expect(hint()).toBeNull());
    expect(localStorage.getItem(SEEN_KEY)).toBeNull();

    await menuPin("Completed older");
    await waitFor(() => expect(hint()).not.toBeNull());
  });

  it("stays hidden when the flag is already persisted", async () => {
    localStorage.setItem(SEEN_KEY, "true");
    await renderSidebar();
    await menuPin("Review one");
    expect(readPinState().pinnedIds).toStrictEqual(["r1"]);
    expect(hint()).toBeNull();
  });

  it("stays hidden when the sidebar is collapsed", async () => {
    localStorage.setItem(
      SIDEBAR_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_SIDEBAR_STATE, collapsed: true }),
    );
    await renderSidebar();
    await menuPin("Review one");
    expect(readPinState().pinnedIds).toStrictEqual(["r1"]);
    expect(hint()).toBeNull();
  });

  it("the first drag pin marks the hint seen", async () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      const top = this.matches("[data-pin-drop-row]")
        ? 200
        : this.matches('[data-testid="sidebar-recents"]')
          ? 300
          : 0;
      const height = this.matches('[data-testid="sidebar-pinned"]')
        ? 250
        : this.matches('[data-testid="sidebar-recents"]')
          ? 400
          : 32;
      return {
        top,
        bottom: top + height,
        height,
        left: 0,
        right: 240,
        width: 240,
        x: 0,
        y: top,
        toJSON: () => ({}),
      } as DOMRect;
    });
    await renderSidebar();
    const link = screen.getByText("Review one").closest("a[data-row-main-button]");
    if (!(link instanceof HTMLElement)) throw new Error("no row");

    fireEvent.pointerDown(link, { button: 0, pointerId: 1, clientX: 50, clientY: 400 });
    act(() => {
      fireEvent.pointerMove(window, { pointerId: 1, clientX: 50, clientY: 380 });
    });
    act(() => {
      fireEvent.pointerMove(window, { pointerId: 1, clientX: 50, clientY: 210 });
    });
    act(() => {
      fireEvent.pointerUp(window, { pointerId: 1, clientX: 50, clientY: 210 });
    });

    await waitFor(() => expect(readPinState().pinnedIds).toStrictEqual(["r1"]));
    await waitFor(() => expect(localStorage.getItem(SEEN_KEY)).toBe("true"));
  });
});
