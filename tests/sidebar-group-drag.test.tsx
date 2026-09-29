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
import { SESSION_GROUP_STORAGE_KEY, readSessionGroupState } from "../src/lib/session-group-store";
import { DEFAULT_SESSION_LIST_PREFS } from "../src/lib/session-groups";
import { installLocalStorage } from "./fake-storage";

const MINUTE = 60 * 1000;

function session(id: string, title: string, minutesAgo: number) {
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
    state: "idle",
    bucket: "done",
    liveAgentCount: 0,
    unseen: false,
    blockedSince: null,
  };
}

const FIXTURE = [
  session("a1", "Alpha one", 1),
  session("a2", "Alpha two", 2),
  session("b1", "Beta one", 3),
  session("u1", "Loose one", 4),
  session("u2", "Loose two", 5),
];

const ALPHA = { id: "cg-a", name: "Alpha" };
const BETA = { id: "cg-b", name: "Beta" };
const SEEDED_ASSIGNMENTS = { a1: "cg-a", a2: "cg-a", b1: "cg-b" };

function seedGroups(): void {
  localStorage.setItem(
    SESSION_GROUP_STORAGE_KEY,
    JSON.stringify({ groups: [ALPHA, BETA], assignments: SEEDED_ASSIGNMENTS, order: {} }),
  );
}

async function renderGroups() {
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
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <SessionGroups
            activeItemId={null}
            prefs={{ ...DEFAULT_SESSION_LIST_PREFS, groupBy: "custom" }}
          />
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
  return result;
}

const ROW_STEP = 33;
const RECENTS_TOP = 300;
const UNIT_SELECTOR = "[data-sidebar-group-label], [data-drag-id], [data-ungroup-drop-row]";

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
 * Sidebar geometry: the Pinned section spans 0-250 (pinned rows every 33px from 33,
 * the pin drop row at 200). Below it, from 300, every group header, row and the
 * Ungroup drop row takes a 33px step in DOM order; containers span their units.
 */
function layout(element: Element): DOMRect {
  if (element.matches('[data-testid="sidebar-pinned"]')) return rect(0, 250);
  if (element.matches("[data-pin-drop-row]")) return rect(200, 32);
  if (element.matches('[data-testid="sidebar-recents"]')) return rect(RECENTS_TOP, 600);
  const pinned = element.closest('[data-testid="sidebar-pinned"]');
  if (pinned !== null) {
    const index = [...pinned.querySelectorAll("[data-drag-id]")].indexOf(element);
    return index === -1 ? rect(0, 0) : rect(ROW_STEP * (index + 1), 32);
  }
  const recents = element.closest('[data-testid="sidebar-recents"]');
  if (recents === null) return rect(0, 0);
  const units = [...recents.querySelectorAll(UNIT_SELECTOR)];
  const top = (unit: Element) => RECENTS_TOP + ROW_STEP * units.indexOf(unit);
  if (element.matches(UNIT_SELECTOR)) return rect(top(element), 32);
  const inside = units.filter((unit) => element.contains(unit));
  const first = inside[0];
  const last = inside.at(-1);
  if (first === undefined || last === undefined) return rect(0, 0);
  return rect(top(first), top(last) + 32 - top(first));
}

/** Center y of the n-th layout unit below the Pinned section. */
function unitY(index: number): number {
  return RECENTS_TOP + ROW_STEP * index + 16;
}

function rowLink(title: string): HTMLElement {
  const link = screen.getByText(title).closest("a[data-row-main-button]");
  if (!(link instanceof HTMLElement)) throw new Error(`no row ${title}`);
  return link;
}

function groupToggle(label: string): HTMLElement {
  const toggle = screen.getByText(label).closest("[data-group-toggle]");
  if (!(toggle instanceof HTMLElement)) throw new Error(`no group ${label}`);
  return toggle;
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

function drag(element: HTMLElement, fromY: number, toY: number): void {
  fireEvent.pointerDown(element, { button: 0, pointerId: 1, clientX: 50, clientY: fromY });
  pointerMove(fromY - 20);
  pointerMove(toY);
  pointerUp(toY);
}

/** Section labels with their row titles, in display order. */
function sections(container: HTMLElement): [string, string[]][] {
  return [...container.querySelectorAll('[data-testid="sidebar-recents"] [data-group-key]')].map(
    (section) => [
      section.querySelector("[data-group-name]")?.textContent ?? "",
      [...section.querySelectorAll("a[data-row-main-button]")].map(
        (link) => link.textContent ?? "",
      ),
    ],
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  installLocalStorage();
  seedGroups();
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    return layout(this);
  });
});

// Units: 0 Alpha, 1 Alpha one, 2 Alpha two, 3 Beta, 4 Beta one, 5 Ungrouped, 6 Loose one, 7 Loose two.

describe("sidebar drag to custom groups", () => {
  it("assigns an ungrouped row dropped between two group rows at that slot", async () => {
    const { container } = await renderGroups();

    drag(rowLink("Loose one"), unitY(6), unitY(1) + 12);

    await waitFor(() =>
      expect(sections(container)).toStrictEqual([
        ["Alpha", ["Alpha one", "Loose one", "Alpha two"]],
        ["Beta", ["Beta one"]],
        ["Ungrouped", ["Loose two"]],
      ]),
    );
    expect(readSessionGroupState()).toStrictEqual({
      groups: [ALPHA, BETA],
      assignments: { ...SEEDED_ASSIGNMENTS, u1: "cg-a" },
      order: { "cg-a": ["a1", "u1", "a2"] },
    });
  });

  it("puts a row dropped on a group header at the top of that group", async () => {
    const { container } = await renderGroups();

    drag(rowLink("Loose two"), unitY(7), unitY(3));

    await waitFor(() =>
      expect(sections(container)).toStrictEqual([
        ["Alpha", ["Alpha one", "Alpha two"]],
        ["Beta", ["Loose two", "Beta one"]],
        ["Ungrouped", ["Loose one"]],
      ]),
    );
    expect(readSessionGroupState().order).toStrictEqual({ "cg-b": ["u2", "b1"] });
  });

  it("shows the Ungroup row only while a grouped row is dragged and ungroups on drop", async () => {
    const { container } = await renderGroups();
    const ungroupRow = () => container.querySelector("[data-ungroup-drop-row]");

    fireEvent.pointerDown(rowLink("Loose one"), {
      button: 0,
      pointerId: 1,
      clientX: 50,
      clientY: unitY(6),
    });
    pointerMove(unitY(6) - 20);
    const whileLoose = ungroupRow();
    pointerUp(unitY(6) - 20);

    fireEvent.pointerDown(rowLink("Alpha one"), {
      button: 0,
      pointerId: 1,
      clientX: 50,
      clientY: unitY(1),
    });
    pointerMove(unitY(1) + 20);
    // The Ungroup row is unit 5, between Beta one and the Ungrouped header.
    pointerMove(unitY(5));
    const hot = { text: ungroupRow()?.textContent, hot: ungroupRow()?.hasAttribute("data-hot") };
    pointerUp(unitY(5));

    await waitFor(() =>
      expect(sections(container)).toStrictEqual([
        ["Alpha", ["Alpha two"]],
        ["Beta", ["Beta one"]],
        ["Ungrouped", ["Alpha one", "Loose one", "Loose two"]],
      ]),
    );
    expect({
      whileLoose,
      hot,
      after: ungroupRow(),
      assignments: readSessionGroupState().assignments,
    }).toStrictEqual({
      whileLoose: null,
      hot: { text: "Ungroup", hot: true },
      after: null,
      assignments: { a2: "cg-a", b1: "cg-b" },
    });
  });

  it("reorders sections when a group header is dragged onto another", async () => {
    const { container } = await renderGroups();

    drag(groupToggle("Beta"), unitY(3), unitY(0));

    await waitFor(() =>
      expect(sections(container).map(([label]) => label)).toStrictEqual([
        "Beta",
        "Alpha",
        "Ungrouped",
      ]),
    );
    expect(readSessionGroupState().groups).toStrictEqual([BETA, ALPHA]);
  });

  it("unpins a pinned row dropped into a group and places it there", async () => {
    localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify({ pinnedIds: ["u2"], pinnedOrder: [] }));
    const { container } = await renderGroups();

    drag(rowLink("Loose two"), 33 + 16, unitY(1) + 12);

    await waitFor(() =>
      expect(sections(container)).toStrictEqual([
        ["Alpha", ["Alpha one", "Loose two", "Alpha two"]],
        ["Beta", ["Beta one"]],
        ["Ungrouped", ["Loose one"]],
      ]),
    );
    expect({
      pins: readPinState(),
      order: readSessionGroupState().order,
    }).toStrictEqual({
      pins: { pinnedIds: [], pinnedOrder: [] },
      order: { "cg-a": ["a1", "u2", "a2"] },
    });
  });

  it("still unpins a pinned row dropped on the Ungrouped section", async () => {
    localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify({ pinnedIds: ["u2"], pinnedOrder: [] }));
    const { container } = await renderGroups();

    drag(rowLink("Loose two"), 33 + 16, unitY(6));

    await waitFor(() =>
      expect(sections(container)).toStrictEqual([
        ["Alpha", ["Alpha one", "Alpha two"]],
        ["Beta", ["Beta one"]],
        ["Ungrouped", ["Loose one", "Loose two"]],
      ]),
    );
    expect(readPinState()).toStrictEqual({ pinnedIds: [], pinnedOrder: [] });
  });
});
