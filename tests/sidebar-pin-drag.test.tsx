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

import { SessionGroups } from "../src/components/sidebar/session-groups";
import { ToastProvider } from "../src/components/toast";
import {
  RecentSessionsResponse,
  recentSessionsInfiniteQueryOptions,
} from "../src/lib/api/sessions";
import { PIN_STORAGE_KEY, readPinState } from "../src/lib/pin-store";
import type { SessionBucket } from "../src/lib/session-state";
import { installLocalStorage } from "./fake-storage";

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
  session("w1", "Working one", "working", 1),
  session("r1", "Review one", "review", 2),
  session("b1", "Blocked one", "blocked", 3),
  session("d2", "Completed older", "done", 30),
];

function seedPins(pinnedIds: string[], pinnedOrder: string[] = []): void {
  localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify({ pinnedIds, pinnedOrder }));
}

async function renderGroups(sessions: unknown[]) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
        gcTime: Infinity,
        refetchOnMount: false,
      },
    },
  });
  queryClient.setQueryData(recentSessionsInfiniteQueryOptions().queryKey, {
    pages: [RecentSessionsResponse.parse({ sessions, nextCursor: null })],
    pageParams: [null],
  });
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <SessionGroups activeItemId={null} />
          <Outlet />
        </ToastProvider>
      </QueryClientProvider>
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
  return { ...result, router };
}

const ROW_STEP = 33;
const PINNED_TOP = 0;
const DROP_ROW_TOP = 200;
const RECENTS_TOP = 300;

function rect(top: number, height: number): DOMRect {
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
}

/**
 * Sidebar geometry: the Pinned section spans 0-250 (header row, pinned rows every
 * 33px from 33, the drop row at 200) and the recents list starts at 300.
 */
function layout(element: Element): DOMRect {
  if (element.matches('[data-testid="sidebar-pinned"]')) return rect(PINNED_TOP, 250);
  if (element.matches("[data-pin-drop-row]")) return rect(DROP_ROW_TOP, 32);
  if (element.matches('[data-testid="sidebar-recents"]')) return rect(RECENTS_TOP, 400);
  if (element.matches("[data-drag-id]")) {
    const section = element.closest(
      '[data-testid="sidebar-pinned"], [data-testid="sidebar-recents"]',
    );
    if (section === null) return rect(0, 0);
    const index = [...section.querySelectorAll("[data-drag-id]")].indexOf(element);
    const top = section.matches('[data-testid="sidebar-pinned"]') ? PINNED_TOP : RECENTS_TOP;
    return rect(top + ROW_STEP * (index + 1), 32);
  }
  return rect(0, 0);
}

function rowLink(title: string): HTMLElement {
  const link = screen.getByText(title).closest("a[data-row-main-button]");
  if (!(link instanceof HTMLElement)) throw new Error(`no row ${title}`);
  return link;
}

function pointerDown(title: string, clientY: number): void {
  fireEvent.pointerDown(rowLink(title), {
    button: 0,
    pointerId: 1,
    clientX: 50,
    clientY,
  });
}

function pointerMove(clientY: number): void {
  act(() => {
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 50, clientY });
  });
}

function pointerUp(clientY: number): void {
  act(() => {
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 50, clientY });
  });
}

function dragTo(title: string, clientY: number): void {
  pointerDown(title, 400);
  pointerMove(380);
  pointerMove(clientY);
  pointerUp(clientY);
}

function pinnedSection(container: HTMLElement): HTMLElement {
  const section = container.querySelector('[data-testid="sidebar-pinned"]');
  if (!(section instanceof HTMLElement)) throw new Error("no Pinned section");
  return section;
}

function pinnedTitles(container: HTMLElement): string[] {
  return [...pinnedSection(container).querySelectorAll("a[data-row-main-button]")].map(
    (link) => link.textContent ?? "",
  );
}

function dropRow(container: HTMLElement) {
  const row = container.querySelector("[data-pin-drop-row]");
  if (row === null) return null;
  const icon = row.querySelector("svg");
  return {
    text: row.textContent,
    hot: row.hasAttribute("data-hot"),
    iconTilted:
      icon?.classList.contains("rotate-6") === true && icon.classList.contains("scale-105"),
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  installLocalStorage();
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    return layout(this);
  });
});

describe("sidebar drag to pin", () => {
  it("reveals the Pinned drop row during any drag and pins a row dropped on it", async () => {
    const { container } = await renderGroups(FIXTURE);
    expect(dropRow(container)).toBeNull();

    pointerDown("Review one", 400);
    pointerMove(380);
    expect({
      stub: pinnedSection(container).hasAttribute("data-stub"),
      dropRow: dropRow(container),
    }).toStrictEqual({
      stub: false,
      dropRow: { text: "Drop here", hot: false, iconTilted: true },
    });

    pointerMove(DROP_ROW_TOP + 10);
    expect(dropRow(container)).toStrictEqual({
      text: "Let go",
      hot: true,
      iconTilted: true,
    });

    pointerUp(DROP_ROW_TOP + 10);
    await waitFor(() => expect(pinnedTitles(container)).toStrictEqual(["Review one"]));
    expect(readPinState()).toStrictEqual({
      pinnedIds: ["r1"],
      pinnedOrder: ["r1"],
    });
    expect(dropRow(container)).toBeNull();
  });

  it("pins a recents row at the slot it is dropped on", async () => {
    seedPins(["w1", "d2"]);
    const { container } = await renderGroups(FIXTURE);

    dragTo("Review one", 70);

    await waitFor(() =>
      expect(pinnedTitles(container)).toStrictEqual([
        "Working one",
        "Review one",
        "Completed older",
      ]),
    );
    expect(readPinState()).toStrictEqual({
      pinnedIds: ["w1", "d2", "r1"],
      pinnedOrder: ["w1", "r1", "d2"],
    });
  });

  it("reorders a pinned row dropped on another slot", async () => {
    seedPins(["w1", "d2", "r1"], ["w1", "d2", "r1"]);
    const { container } = await renderGroups(FIXTURE);

    dragTo("Working one", 130);

    await waitFor(() =>
      expect(pinnedTitles(container)).toStrictEqual([
        "Completed older",
        "Review one",
        "Working one",
      ]),
    );
    expect(readPinState()).toStrictEqual({
      pinnedIds: ["w1", "d2", "r1"],
      pinnedOrder: ["d2", "r1", "w1"],
    });
  });

  it("unpins a pinned row dragged below the list, and Undo re-pins it at its old index", async () => {
    seedPins(["w1", "d2", "r1"], ["w1", "d2", "r1"]);
    const { container } = await renderGroups(FIXTURE);

    dragTo("Completed older", RECENTS_TOP + 100);

    await waitFor(() =>
      expect(pinnedTitles(container)).toStrictEqual(["Working one", "Review one"]),
    );
    expect(readPinState()).toStrictEqual({
      pinnedIds: ["w1", "r1"],
      pinnedOrder: ["w1", "r1"],
    });
    const toast = await screen.findByText("Unpinned Completed older");
    expect(toast.closest("[data-toast]")?.getAttribute("data-kind")).toBe("success");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    await waitFor(() =>
      expect(pinnedTitles(container)).toStrictEqual([
        "Working one",
        "Completed older",
        "Review one",
      ]),
    );
    expect(readPinState()).toStrictEqual({
      pinnedIds: ["w1", "r1", "d2"],
      pinnedOrder: ["w1", "d2", "r1"],
    });
  });

  it("cancels the drag on Escape without changing the pins", async () => {
    seedPins(["w1"]);
    const { container } = await renderGroups(FIXTURE);

    pointerDown("Review one", 400);
    pointerMove(380);
    pointerMove(40);
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    pointerUp(40);

    expect({
      pins: readPinState(),
      pinned: pinnedTitles(container),
      ghosts: document.querySelectorAll("[data-drag-ghost]").length,
      dragging: document.documentElement.hasAttribute("data-session-dragging"),
      dropRow: dropRow(container),
    }).toStrictEqual({
      pins: { pinnedIds: ["w1"], pinnedOrder: [] },
      pinned: ["Working one"],
      ghosts: 0,
      dragging: false,
      dropRow: null,
    });
  });

  it("still navigates when the pointer moves less than the drag threshold", async () => {
    const { router } = await renderGroups(FIXTURE);

    pointerDown("Review one", 400);
    pointerMove(402);
    pointerUp(402);
    fireEvent.click(rowLink("Review one"));

    await waitFor(() => expect(router.state.location.pathname).toBe("/session/r1"));
    expect(readPinState()).toStrictEqual({ pinnedIds: [], pinnedOrder: [] });
  });
});
