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
import { __unreadStoreTesting, hasUnseenWork } from "../src/lib/unread-store";
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
  session("b1", "Beta one", 3),
  session("u1", "Loose one", 4),
  session("u2", "Loose two", 5),
  session("u3", "Loose three", 6),
];

const ALPHA = { id: "cg-a", name: "Alpha" };
const BETA = { id: "cg-b", name: "Beta" };
const SEEDED_ASSIGNMENTS = { a1: "cg-a", b1: "cg-b" };

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();

function archiveCalls(): Array<{ url: string; method: string | undefined }> {
  return fetchMock.mock.calls
    .map(([input, init]) => ({ url: input, method: init?.method }))
    .filter((call) => call.url.endsWith("/archived"));
}

async function renderGroups({ groupBy = "custom" }: { groupBy?: "custom" | "state" } = {}) {
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
          <SessionGroups activeItemId={null} prefs={{ ...DEFAULT_SESSION_LIST_PREFS, groupBy }} />
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

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function rowLink(title: string): HTMLElement {
  const link = screen.getByText(title).closest("a[data-row-main-button]");
  if (!(link instanceof HTMLElement)) throw new Error(`no row ${title}`);
  return link;
}

/** Titles of the rows marked multi-selected, in display order. */
function selectedTitles(container: HTMLElement): string[] {
  return [...container.querySelectorAll("a[data-row-main-button][data-multi-selected]")].map(
    (link) => link.textContent ?? "",
  );
}

function cmdClick(title: string): void {
  fireEvent.click(rowLink(title), { metaKey: true });
}

function shiftClick(title: string): void {
  fireEvent.click(rowLink(title), { shiftKey: true });
}

async function openRowMenu(title: string): Promise<HTMLElement> {
  fireEvent.contextMenu(rowLink(title), { clientX: 40, clientY: 50 });
  await flush();
  return await waitFor(() => screen.getByRole("menu"));
}

function menuOutline(menu: HTMLElement): string[] {
  return [
    ...menu.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="separator"]'),
  ].map((node) => (node.getAttribute("role") === "separator" ? "---" : (node.textContent ?? "")));
}

async function openSubmenu(name: RegExp): Promise<HTMLElement> {
  const trigger = screen.getByRole("menuitem", { name });
  act(() => trigger.focus());
  fireEvent.keyDown(trigger, { key: "ArrowRight" });
  await flush();
  const menus = screen.getAllByRole("menu");
  expect(menus).toHaveLength(2);
  return menus[1]!;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  installLocalStorage();
  localStorage.setItem(
    SESSION_GROUP_STORAGE_KEY,
    JSON.stringify({ groups: [ALPHA, BETA], assignments: SEEDED_ASSIGNMENTS, order: {} }),
  );
  fetchMock.mockReset();
  fetchMock.mockImplementation((_input, init) =>
    Promise.resolve(Response.json({ archived: init?.method === "PUT" })),
  );
  vi.stubGlobal("fetch", fetchMock);
  __unreadStoreTesting.reset();
  __unreadStoreTesting.setPersist(() => Promise.resolve());
});

describe("sidebar multi-select", () => {
  it("⌘-click toggles rows into the selection without navigating", async () => {
    const { container, router } = await renderGroups();

    cmdClick("Loose one");
    cmdClick("Alpha one");
    const both = selectedTitles(container);
    cmdClick("Loose one");

    expect({
      both,
      after: selectedTitles(container),
      path: router.state.location.pathname,
    }).toStrictEqual({ both: ["Alpha one", "Loose one"], after: ["Alpha one"], path: "/" });
  });

  it("⇧-click selects the displayed range from the anchor", async () => {
    const { container } = await renderGroups();

    cmdClick("Beta one");
    shiftClick("Loose two");

    expect(selectedTitles(container)).toStrictEqual(["Beta one", "Loose one", "Loose two"]);
  });

  it("a plain click clears the selection and opens the session", async () => {
    const { container, router } = await renderGroups();
    cmdClick("Loose one");
    cmdClick("Loose two");

    fireEvent.click(rowLink("Loose three"));

    await waitFor(() => expect(router.state.location.pathname).toBe("/session/u3"));
    expect(selectedTitles(container)).toStrictEqual([]);
  });

  it("Escape clears the selection", async () => {
    const { container } = await renderGroups();
    cmdClick("Loose one");
    cmdClick("Loose two");

    fireEvent.keyDown(window, { key: "Escape" });

    expect(selectedTitles(container)).toStrictEqual([]);
  });
});

describe("sidebar bulk menu", () => {
  it("offers only the bulk actions on a selected row, with no Delete", async () => {
    await renderGroups();
    cmdClick("Loose one");
    cmdClick("Loose two");

    const menu = await openRowMenu("Loose two");

    expect(menuOutline(menu)).toStrictEqual([
      "Mark as unreadU",
      "---",
      "Move 2 to group",
      "---",
      "ArchiveA",
    ]);
  });

  it("keeps the single-row menu on a row outside the selection", async () => {
    await renderGroups();
    cmdClick("Loose one");
    cmdClick("Loose two");

    const menu = await openRowMenu("Loose three");

    expect(menuOutline(menu)).toContain("RenameR");
  });

  it("moves every selected row into the picked group and clears the selection", async () => {
    const { container } = await renderGroups();
    cmdClick("Loose one");
    cmdClick("Loose three");
    await openRowMenu("Loose one");

    const submenu = await openSubmenu(/^Move 2 to group/);
    expect(menuOutline(submenu)).toStrictEqual(["Alpha1", "Beta2", "---", "New group…3"]);
    fireEvent.keyDown(submenu, { key: "2" });
    await flush();

    expect({
      assignments: readSessionGroupState().assignments,
      selected: selectedTitles(container),
    }).toStrictEqual({
      assignments: { ...SEEDED_ASSIGNMENTS, u1: "cg-b", u3: "cg-b" },
      selected: [],
    });
  });

  it("New group… creates a group holding every selected row", async () => {
    await renderGroups();
    cmdClick("Loose one");
    cmdClick("Loose two");
    await openRowMenu("Loose two");
    const submenu = await openSubmenu(/^Move 2 to group/);

    fireEvent.keyDown(submenu, { key: "3" });
    await flush();
    const dialog = await waitFor(() => screen.getByRole("dialog"));
    fireEvent.change(screen.getByPlaceholderText("Group name"), { target: { value: "Gamma" } });
    fireEvent.submit(dialog.querySelector("form")!);
    await flush();

    const { groups, assignments } = readSessionGroupState();
    const gamma = groups.find((group) => group.name === "Gamma");
    expect({ groupNames: groups.map((group) => group.name), assignments }).toStrictEqual({
      groupNames: ["Alpha", "Beta", "Gamma"],
      assignments: { ...SEEDED_ASSIGNMENTS, u1: gamma?.id, u2: gamma?.id },
    });
  });

  it("marks every selected row unread", async () => {
    await renderGroups();
    cmdClick("Loose one");
    cmdClick("Beta one");
    const menu = await openRowMenu("Beta one");

    fireEvent.keyDown(menu, { key: "u" });
    await flush();

    expect(["b1", "u1", "u2"].map((id) => hasUnseenWork(id))).toStrictEqual([true, true, false]);
  });

  it("archives every selected row with one Undo toast", async () => {
    await renderGroups();
    cmdClick("Loose one");
    cmdClick("Loose two");
    const menu = await openRowMenu("Loose one");

    fireEvent.keyDown(menu, { key: "a" });

    await waitFor(() => expect(screen.getByText("Archived 2 sessions")).toBeTruthy());
    expect(archiveCalls()).toStrictEqual([
      { url: "/api/sessions/u1/archived", method: "PUT" },
      { url: "/api/sessions/u2/archived", method: "PUT" },
    ]);
  });
});

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

/** Pinned spans 0-250; below it every header and row takes a 33px step from 300. */
function layout(element: Element): DOMRect {
  if (element.matches('[data-testid="sidebar-pinned"]')) return rect(0, 250);
  if (element.matches("[data-pin-drop-row]")) return rect(200, 32);
  if (element.matches('[data-testid="sidebar-recents"]')) return rect(RECENTS_TOP, 600);
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

function unitY(index: number): number {
  return RECENTS_TOP + ROW_STEP * index + 16;
}

function pointer(type: "move" | "up", clientY: number): void {
  act(() => {
    const init = { pointerId: 1, clientX: 50, clientY };
    if (type === "move") fireEvent.pointerMove(window, init);
    else fireEvent.pointerUp(window, init);
  });
}

// Units: 0 Alpha, 1 Alpha one, 2 Beta, 3 Beta one, 4 Ungrouped, 5 Loose one, 6 Loose two, 7 Loose three.

describe("sidebar multi-row drag", () => {
  beforeEach(() => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      return layout(this);
    });
  });

  it("drops every selected row onto a group header, keeping their order", async () => {
    const { container } = await renderGroups();
    cmdClick("Loose one");
    cmdClick("Loose three");

    fireEvent.pointerDown(rowLink("Loose three"), {
      button: 0,
      pointerId: 1,
      clientX: 50,
      clientY: unitY(7),
    });
    pointer("move", unitY(7) - 20);
    const pinDropRow = container.querySelector("[data-pin-drop-row]");
    pointer("move", unitY(0));
    pointer("up", unitY(0));

    await waitFor(() =>
      expect(readSessionGroupState()).toStrictEqual({
        groups: [ALPHA, BETA],
        assignments: { ...SEEDED_ASSIGNMENTS, u1: "cg-a", u3: "cg-a" },
        order: { "cg-a": ["u1", "u3", "a1"] },
      }),
    );
    expect({ pinDropRow, selected: selectedTitles(container) }).toStrictEqual({
      pinDropRow: null,
      selected: [],
    });
  });

  it("cannot pin a multi-row drag", async () => {
    localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify({ pinnedIds: [], pinnedOrder: [] }));
    await renderGroups();
    cmdClick("Loose one");
    cmdClick("Loose two");

    fireEvent.pointerDown(rowLink("Loose two"), {
      button: 0,
      pointerId: 1,
      clientX: 50,
      clientY: unitY(6),
    });
    pointer("move", unitY(6) - 20);
    pointer("move", 216);
    pointer("up", 216);
    await flush();

    expect({
      pins: readPinState(),
      assignments: readSessionGroupState().assignments,
    }).toStrictEqual({
      pins: { pinnedIds: [], pinnedOrder: [] },
      assignments: SEEDED_ASSIGNMENTS,
    });
  });
});
