// @vitest-environment jsdom

import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  HeadContent,
  notFound,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { loadRecents } from "../src/lib/recents-history";

const harness = vi.hoisted(() => ({
  removeSession: null as ((sessionId: string) => void) | null,
}));

vi.mock("../src/hooks/use-claude-events", () => ({
  useSubscribeSessionRemovals: () => (listener: (sessionId: string) => void) => {
    harness.removeSession = listener;
    return () => {
      harness.removeSession = null;
    };
  },
}));

const { useRecentsRecorder } = await import("../src/hooks/use-recents-recorder");

const SESSION_TITLES: Record<string, string | null> = {
  "session-alpha": "Alpha session",
  "session-beta": "Beta session",
  "session-missing": null,
};

function Recorder(): null {
  useRecentsRecorder();
  return null;
}

function renderRoutedApp(initialPath: string) {
  const rootRoute = createRootRoute({
    head: () => ({ meta: [{ charSet: "utf-8" }] }),
    component: () => (
      <>
        <HeadContent />
        <Recorder />
        <Outlet />
      </>
    ),
    notFoundComponent: () => <div>404</div>,
  });
  const sessionRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/session/$id",
    loader: ({ params }) => SESSION_TITLES[params.id] ?? null,
    head: ({ loaderData }) => ({
      meta: [{ title: loaderData ?? "Session Not Found" }],
    }),
    component: () => <div>session</div>,
  });
  const planRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/plan/$filename",
    loader: () => {
      throw notFound();
    },
    head: ({ params }) => ({ meta: [{ title: params.filename }] }),
    component: () => <div>plan</div>,
  });
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings",
    head: () => ({ meta: [{ title: "Settings" }] }),
    component: () => <div>settings</div>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([sessionRoute, planRoute, settingsRoute]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
  render(<RouterProvider router={router as never} />);
  return router;
}

async function start(initialPath: string) {
  const router = renderRoutedApp(initialPath);
  await act(async () => {
    await router.load();
  });
  return router;
}

async function go(router: ReturnType<typeof renderRoutedApp>, to: string) {
  await act(async () => {
    await router.navigate({ to } as never);
  });
}

const ALPHA = {
  key: "session:session-alpha",
  kind: "session",
  href: "/session/session-alpha",
  title: "Alpha session",
};
const BETA = {
  key: "session:session-beta",
  kind: "session",
  href: "/session/session-beta",
  title: "Beta session",
};

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  harness.removeSession = null;
  document.title = "";
  sessionStorage.clear();
});

describe("useRecentsRecorder", () => {
  it("records A then B then A as exactly [A, B] with titles", async () => {
    const router = await start("/session/session-alpha");
    await go(router, "/session/session-beta");
    await go(router, "/session/session-alpha");

    expect(loadRecents()).toStrictEqual([ALPHA, BETA]);
  });

  it("does not record a session that resolves to Session Not Found", async () => {
    const router = await start("/session/session-alpha");
    await go(router, "/session/session-missing");

    expect(loadRecents()).toStrictEqual([ALPHA]);
  });

  it("does not record a route whose loader throws notFound", async () => {
    const router = await start("/session/session-alpha");
    await go(router, "/plan/gone-plan");

    expect(loadRecents()).toStrictEqual([ALPHA]);
  });

  it("prunes a previously recorded entry once it resolves to not-found", async () => {
    SESSION_TITLES["session-flaky"] = "Flaky session";
    const router = await start("/session/session-flaky");
    await go(router, "/session/session-alpha");
    SESSION_TITLES["session-flaky"] = null;
    await go(router, "/session/session-flaky");

    expect(loadRecents()).toStrictEqual([ALPHA]);
    delete SESSION_TITLES["session-flaky"];
  });

  it("ignores routes that are not recordable", async () => {
    const router = await start("/settings");
    await go(router, "/session/session-beta");
    await go(router, "/settings");

    expect(loadRecents()).toStrictEqual([BETA]);
  });

  it("retitles the page being left from document.title", async () => {
    const router = await start("/session/session-alpha");
    document.title = "(2) Alpha renamed";
    await go(router, "/session/session-beta");

    expect(loadRecents()).toStrictEqual([BETA, { ...ALPHA, title: "Alpha renamed" }]);
  });

  it("removes a session entry when the SSE stream reports it removed", async () => {
    const router = await start("/session/session-alpha");
    await go(router, "/session/session-beta");

    act(() => {
      harness.removeSession?.("session-alpha");
    });

    expect(loadRecents()).toStrictEqual([BETA]);
  });
});
