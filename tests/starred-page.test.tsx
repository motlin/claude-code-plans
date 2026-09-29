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
import { StarredSessionsPage } from "../src/components/starred-sessions-page";
import type { SessionListItem } from "../src/lib/api/sessions";
import { movePin, pin, readPinState } from "../src/lib/pin-store";
import { installLocalStorage } from "./fake-storage";

function session(id: string, title: string, mtime: string): SessionListItem {
  return {
    id,
    title,
    mtime,
    created: mtime,
    project: "-fixture-alice-project",
    projectName: "alice-project",
    messageCount: 0,
    archived: false,
    state: "ended",
    bucket: "done",
    liveAgentCount: 0,
    unseen: false,
    blockedSince: null,
  };
}

const SESSIONS = [
  session("session-alice", "Alice session", "2000-01-03T00:00:00.000Z"),
  session("session-bob", "Bob session", "2000-01-02T00:00:00.000Z"),
  session("session-carol", "Carol session", "2000-01-01T00:00:00.000Z"),
];

const fetchMock = vi.fn(async (url: string) => {
  const ids = new URL(url, "http://localhost").searchParams.get("ids")?.split(",") ?? [];
  return Response.json(SESSIONS.filter((s) => ids.includes(s.id)));
});

async function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <Outlet />
      </QueryClientProvider>
    ),
  });
  const starredRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: StarredSessionsPage,
  });
  const sessionRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "session/$id",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([starredRoute, sessionRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
}

function titles(): string[] {
  return screen
    .queryAllByRole("listitem")
    .map((item) => item.querySelector("a div")?.textContent ?? "");
}

describe("StarredSessionsPage", () => {
  beforeEach(() => {
    installLocalStorage();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    fetchMock.mockClear();
  });

  it("shows the empty state without asking the server when nothing is pinned", async () => {
    await renderPage();

    await screen.findByText("No starred sessions yet. Star a session from its detail page.");
    expect(fetchMock.mock.calls).toStrictEqual([]);
  });

  it("lists this browser's pins, user-ordered first, then newest first", async () => {
    pin("session-carol");
    pin("session-alice");
    pin("session-bob");
    movePin("session-carol", null);

    await renderPage();

    await waitFor(() =>
      expect(titles()).toStrictEqual(["Carol session", "Alice session", "Bob session"]),
    );
  });

  it("unpins from the hover button and follows other tabs", async () => {
    pin("session-alice");
    pin("session-bob");
    await renderPage();
    await waitFor(() => expect(titles()).toStrictEqual(["Alice session", "Bob session"]));

    fireEvent.click(screen.getAllByRole("button", { name: "Unstar" })[0]!);
    await waitFor(() => expect(titles()).toStrictEqual(["Bob session"]));
    const afterUnstar = readPinState();

    const otherTab = JSON.stringify({
      pinnedIds: ["session-bob", "session-carol"],
      pinnedOrder: [],
    });
    act(() => {
      localStorage.setItem("ccp-pins", otherTab);
      window.dispatchEvent(new StorageEvent("storage", { key: "ccp-pins", newValue: otherTab }));
    });

    await waitFor(() => expect(titles()).toStrictEqual(["Bob session", "Carol session"]));
    expect(afterUnstar).toStrictEqual({ pinnedIds: ["session-bob"], pinnedOrder: [] });
  });
});
