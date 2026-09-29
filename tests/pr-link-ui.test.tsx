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
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { SessionActionsMenu } from "../src/components/session-actions-menu";
import { SessionTitleHeading } from "../src/components/session-title-heading";
import { ToastProvider } from "../src/components/toast";
import { herdrPanesQueryOptions } from "../src/lib/api/herdr";
import { sessionOpenInQueryOptions, type SessionListItem } from "../src/lib/api/sessions";
import { __unreadStoreTesting } from "../src/lib/unread-store";

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const SESSION_ID = "8f0c2c7e-1111-4222-8333-944445555666";
const PR = {
  number: 7,
  url: "https://github.com/alice/repository/pull/7",
  repository: "alice/repository",
};

function listItem(overrides: Partial<SessionListItem> = {}): SessionListItem {
  return {
    id: SESSION_ID,
    title: "Fix the flaky test",
    mtime: "2026-09-28T10:00:00.000Z",
    created: "2026-09-28T09:00:00.000Z",
    project: "-projects-alpha",
    projectName: "alpha",
    messageCount: 4,
    starred: false,
    archived: false,
    state: "ended",
    bucket: "done",
    liveAgentCount: 0,
    unseen: false,
    blockedSince: null,
    ...overrides,
  };
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderWithRouter(content: ReactNode, cwd: string | null = null) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity, refetchOnMount: false },
    },
  });
  queryClient.setQueryData(herdrPanesQueryOptions.queryKey, { panes: [], writesEnabled: false });
  queryClient.setQueryData(sessionOpenInQueryOptions(SESSION_ID).queryKey, {
    cwd,
    bridgeSessionId: null,
  });
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          {content}
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
  const router = createRouter({
    routeTree: rootRoute.addChildren([homeRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  await flush();
}

async function openRowMenu(
  session: SessionListItem,
  cwd: string | null = null,
): Promise<HTMLElement> {
  await renderWithRouter(
    <SessionActionsMenu session={session}>
      <a href={`/session/${session.id}`}>Row title</a>
    </SessionActionsMenu>,
    cwd,
  );
  fireEvent.contextMenu(screen.getByText("Row title"), { clientX: 40, clientY: 50 });
  await flush();
  return screen.getByRole("menu");
}

function menuItems(menu: HTMLElement): string[] {
  return [...menu.querySelectorAll('[role="menuitem"]')].map(
    (node) => `${node.textContent ?? ""} [${node.getAttribute("aria-keyshortcuts") ?? ""}]`,
  );
}

const openMock = vi.fn<(url?: string | URL, target?: string, features?: string) => null>();

beforeEach(() => {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_UA);
  openMock.mockReset();
  openMock.mockReturnValue(null);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(Response.json({}))),
  );
  vi.spyOn(window, "open").mockImplementation(openMock);
  __unreadStoreTesting.reset();
  __unreadStoreTesting.setPersist(() => Promise.resolve());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  __unreadStoreTesting.reset();
});

describe("Open PR in the session row menu", () => {
  it("offers Open PR with the hidden accelerator g when the session has a PR", async () => {
    const menu = await openRowMenu(listItem({ pr: PR }));

    expect(menuItems(menu)[0]).toBe("Open PR [g]");
  });

  it("hides Open PR when the session has no PR", async () => {
    const menu = await openRowMenu(listItem());

    expect(menuItems(menu).filter((item) => item.startsWith("Open PR"))).toEqual([]);
  });

  it("opens the PR URL in a new tab on g", async () => {
    const menu = await openRowMenu(listItem({ pr: PR }));

    fireEvent.keyDown(menu, { key: "g" });
    await flush();

    expect(openMock.mock.calls).toEqual([[PR.url, "_blank", "noopener,noreferrer"]]);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("keeps g as a hidden hotkey when Open in replaces the Open PR item", async () => {
    const menu = await openRowMenu(listItem({ pr: PR }), "/projects/alpha");

    expect(menuItems(menu).filter((item) => item.startsWith("Open"))).toEqual(["Open in []"]);

    fireEvent.keyDown(menu, { key: "g" });
    await flush();

    expect(openMock.mock.calls).toEqual([[PR.url, "_blank", "noopener,noreferrer"]]);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("⌥⌘G on the session page", () => {
  it("opens the exact PR URL in a new tab", async () => {
    await renderWithRouter(
      <SessionTitleHeading
        sessionId={SESSION_ID}
        title="Fix the flaky test"
        archived={false}
        prUrl={PR.url}
      />,
    );

    fireEvent.keyDown(document.body, { key: "©", code: "KeyG", metaKey: true, altKey: true });

    expect(openMock.mock.calls).toEqual([[PR.url, "_blank", "noopener,noreferrer"]]);
  });

  it("does nothing when the session has no PR", async () => {
    await renderWithRouter(
      <SessionTitleHeading sessionId={SESSION_ID} title="Fix the flaky test" archived={false} />,
    );

    fireEvent.keyDown(document.body, { key: "©", code: "KeyG", metaKey: true, altKey: true });

    expect(openMock.mock.calls).toEqual([]);
  });
});
