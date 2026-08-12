// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { SessionPage } from "../src/components/session-page";
import { Route as SessionRoute, sessionHeadTitle } from "../src/routes/session.$id";

// session-chat pulls in HMR-persisted module state that jsdom cannot evaluate; the
// pending states under test never render it.
vi.mock("../src/components/session-chat", () => ({
  SessionChat: () => null,
}));

async function renderWithRouter(element: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({
    component: () => <QueryClientProvider client={queryClient}>{element}</QueryClientProvider>,
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/session/session-test-100"] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("blank-screen prevention on /session/$id", () => {
  it("renders a transcript skeleton, not a not-found page, while the queries are pending", async () => {
    // A fetch that never resolves keeps every session query pending forever.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );

    await renderWithRouter(<SessionPage sessionId="session-test-100" />);

    expect({
      skeleton: screen.getByTestId("session-skeleton") !== null,
      notFound: screen.queryByText("Session Not Found"),
    }).toStrictEqual({ skeleton: true, notFound: null });
  });

  it("warms the caches without awaiting any of them", () => {
    // With `ssr: false` nothing paints until every matched loader resolves, so
    // this loader must never await the (multi-megabyte) transcript payload.
    const never = new Promise<never>(() => {});
    const queryClient = {
      prefetchQuery: vi.fn(() => never),
      prefetchInfiniteQuery: vi.fn(() => never),
      ensureQueryData: vi.fn(() => never),
      ensureInfiniteQueryData: vi.fn(() => never),
      getQueryData: vi.fn(() => undefined),
    };

    const loader = SessionRoute.options.loader as (args: {
      context: unknown;
      params: { id: string };
    }) => unknown;

    expect({
      loaderData: loader({ context: { queryClient }, params: { id: "session-test-100" } }),
      prefetched: queryClient.prefetchQuery.mock.calls.length,
      awaitedQueries:
        queryClient.ensureQueryData.mock.calls.length +
        queryClient.ensureInfiniteQueryData.mock.calls.length,
    }).toStrictEqual({ loaderData: undefined, prefetched: 4, awaitedQueries: 0 });
  });

  it("titles a pending session honestly and keeps not-found for a real 404", () => {
    expect([
      sessionHeadTitle(undefined),
      sessionHeadTitle(null),
      sessionHeadTitle({ title: "Fix the blank session page" }),
    ]).toStrictEqual(["Loading session…", "Session Not Found", "Fix the blank session page"]);
  });

  it("never titles a pending match Session Not Found", async () => {
    const head = SessionRoute.options.head as (args: { loaderData: undefined }) => {
      meta?: Array<{ title?: string }>;
    };

    expect(head({ loaderData: undefined })).toStrictEqual({
      meta: [{ title: "Loading session…" }],
    });
  });
});
