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
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { PendingForkNavigator } from "../src/components/fork-navigator";
import { SessionTitleHeading } from "../src/components/session-title-heading";
import { ToastProvider } from "../src/components/toast";
import { herdrPanesQueryOptions } from "../src/lib/api/herdr";
import { getPendingFork, setPendingFork } from "../src/lib/session-fork";

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const SESSION_ID = "8f0c2c7e-1111-4222-8333-944445555666";
const FORK_ID = "1d2e3f40-5555-4666-8777-988889999000";
const CWD = "/Users/alice/alpha";

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderWithRouter(content: ReactNode, { writesEnabled = false } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity, refetchOnMount: false },
    },
  });
  queryClient.setQueryData(herdrPanesQueryOptions.queryKey, { panes: [], writesEnabled });
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
  const sessionRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/session/$id",
    component: () => <p>session page</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([homeRoute, sessionRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  await flush();
  return router;
}

function pressForkShortcut() {
  fireEvent.keyDown(document.body, { key: "ø", code: "KeyO", metaKey: true, altKey: true });
}

const fetchMock = vi.fn<typeof fetch>();
const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_UA);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    Response.json({ ok: true, tabId: "w1:t2", paneId: "w1:p3", sessionId: null }),
  );
  vi.stubGlobal("fetch", fetchMock);
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setPendingFork(null);
});

describe("⌥⌘O on the session page", () => {
  it("launches the fork in herdr from the session directory", async () => {
    await renderWithRouter(
      <SessionTitleHeading sessionId={SESSION_ID} title="Fix it" archived={false} cwd={CWD} />,
      { writesEnabled: true },
    );

    pressForkShortcut();
    await flush();

    expect(fetchMock.mock.calls.map(([input, init]) => [input, init?.body])).toEqual([
      [
        "/api/herdr/launch",
        JSON.stringify({ cwd: CWD, args: ["--resume", SESSION_ID, "--fork-session"] }),
      ],
    ]);
    expect(getPendingFork()?.parentSessionId).toBe(SESSION_ID);
  });

  it("copies the fork command when herdr writes are disabled", async () => {
    await renderWithRouter(
      <SessionTitleHeading sessionId={SESSION_ID} title="Fix it" archived={false} cwd={CWD} />,
    );

    pressForkShortcut();
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(writeText.mock.calls).toEqual([
      [`cd '${CWD}' && claude --resume ${SESSION_ID} --fork-session`],
    ]);
    await waitFor(() =>
      expect(document.querySelector("[data-toast-message]")?.textContent).toBe(
        "Command copied. Paste it in a terminal to fork this session.",
      ),
    );
  });

  it("does nothing when the session directory is unknown", async () => {
    await renderWithRouter(
      <SessionTitleHeading sessionId={SESSION_ID} title="Fix it" archived={false} cwd={null} />,
      { writesEnabled: true },
    );

    pressForkShortcut();
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe("PendingForkNavigator", () => {
  it("opens the fork once its SessionStart arrives and forgets the pending fork", async () => {
    const since = Date.now();
    setPendingFork({ cwd: CWD, since, sessionId: null, parentSessionId: SESSION_ID });
    const parentOnly = new Map([
      [SESSION_ID, { sessionId: SESSION_ID, cwd: CWD, startedAt: since + 5 }],
    ]);
    const router = await renderWithRouter(<PendingForkNavigator activeSessions={parentOnly} />);

    expect(router.state.location.pathname).toBe("/");

    cleanup();
    const withFork = new Map([
      ...parentOnly,
      [FORK_ID, { sessionId: FORK_ID, cwd: CWD, startedAt: since + 10 }],
    ]);
    const next = await renderWithRouter(<PendingForkNavigator activeSessions={withFork} />);

    await waitFor(() => expect(next.state.location.pathname).toBe(`/session/${FORK_ID}`));
    expect(getPendingFork()).toBeNull();
  });
});
