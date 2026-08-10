// @vitest-environment jsdom

import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  HeadContent,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { DEFAULTS } from "../src/components/settings-provider";
import type { ActivityState } from "../src/lib/session-state";

const harness = vi.hoisted(() => ({
  emit: null as ((session: { sessionId: string; state: ActivityState }) => void) | null,
  desktopNotifications: false,
}));

vi.mock("../src/hooks/use-claude-events", () => ({
  useSubscribeSessionStates: () => (listener: (session: never) => void) => {
    harness.emit = listener as never;
    return () => {
      harness.emit = null;
    };
  },
}));

vi.mock("../src/components/settings-provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/components/settings-provider")>()),
  useSettings: () => ({
    settings: { ...DEFAULTS, desktopNotifications: harness.desktopNotifications },
    loaded: true,
    setSetting: () => undefined,
    setVerbosity: () => undefined,
    resetAll: () => undefined,
  }),
}));

const { AttentionBadgeBridge } = await import("../src/components/attention-badge-bridge");

function renderRoutedApp(initialPath: string) {
  const rootRoute = createRootRoute({
    head: () => ({ meta: [{ charSet: "utf-8" }] }),
    component: () => (
      <>
        <HeadContent />
        <AttentionBadgeBridge />
        <Outlet />
      </>
    ),
  });
  const routes = [
    { path: "/alpha", title: "Alpha" },
    { path: "/beta", title: "Beta" },
  ].map(({ path, title }) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
      head: () => ({ meta: [{ title }] }),
      component: () => <div>{title}</div>,
    }),
  );
  const router = createRouter({
    routeTree: rootRoute.addChildren(routes),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
  render(<RouterProvider router={router as never} />);
  return router;
}

afterEach(() => {
  cleanup();
  harness.emit = null;
  harness.desktopNotifications = false;
  document.title = "";
});

describe("AttentionBadgeBridge document title", () => {
  it("follows the route title across client-side navigation", async () => {
    const router = renderRoutedApp("/alpha");
    await act(async () => {
      await router.load();
    });
    expect(document.title).toBe("Alpha");

    await act(async () => {
      await router.navigate({ to: "/beta" } as never);
    });

    expect(document.title).toBe("Beta");
  });

  it("prefixes the attention count onto the current route title", async () => {
    harness.desktopNotifications = true;
    const router = renderRoutedApp("/alpha");
    await act(async () => {
      await router.load();
    });
    await act(async () => {
      await router.navigate({ to: "/beta" } as never);
    });

    await act(async () => {
      harness.emit?.({ sessionId: "session-test-waiting", state: "waiting" });
    });

    expect(document.title).toBe("(1) Beta");
  });
});
