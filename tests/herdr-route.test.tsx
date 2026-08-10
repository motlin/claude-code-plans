// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { terminalPlacementsQueryOptions } from "../src/lib/api/terminal-placements";
import { Route as HerdrRoute } from "../src/routes/herdr";
import { Route as HerdrTerminalRoute } from "../src/routes/herdr.terminal.$sessionId";

vi.mock("../src/components/herdr-terminal", () => ({
  HerdrTerminal: ({ sessionId }: { sessionId: string }) => (
    <section aria-label="Live read-only terminal">{sessionId}</section>
  ),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function placement({
  active,
  agentStatus,
  number,
}: {
  active: boolean;
  agentStatus: string;
  number: number;
}) {
  return {
    provider: "herdr" as const,
    sessionId: `session-test-${number}`,
    displayName: `Terminal ${number}`,
    active,
    paneHandle: `pane-test-${number}`,
    scopeHandle: `workspace-test-${number}`,
    capabilities: {
      supportsWrite: true,
      supportsEvents: true,
      supportsObserve: true,
    },
    herdrPane: {
      paneId: `pane-test-${number}`,
      terminalId: `terminal-test-${number}`,
      workspaceId: `workspace-test-${number}`,
      tabId: `tab-test-${number}`,
      focused: active,
      cwd: `/tmp/test/project-${number}`,
      foregroundCwd: `/tmp/test/project-${number}`,
      agentStatus,
      agent: "claude",
      terminalTitle: `Terminal ${number}`,
      agentSessionId: `session-test-${number}`,
      revision: number,
      sessionId: `session-test-${number}`,
      via: "both" as const,
      viewedState: {
        currentMessageIndex: number,
        lastViewedMessageIndex: number,
        reviewTargetMessageIndex: number,
        newMessageCount: 0,
        viewedInCcp: true,
        viewedInHerdr: true,
        viewedAnywhere: true,
      },
    },
  };
}

function routeMeta(route: typeof HerdrRoute | typeof HerdrTerminalRoute) {
  const head = route.options.head as () => { meta: Array<{ title: string }> };
  return head().meta;
}

describe("HerdrPage", () => {
  it("uses Herdr agent state rather than pane focus for each row's status color", async () => {
    const HerdrPage = HerdrRoute.options.component;
    if (!HerdrPage) throw new Error("Expected the Herdr route component");

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(terminalPlacementsQueryOptions.queryKey, {
      placements: [
        placement({ active: true, agentStatus: "blocked", number: 100 }),
        placement({ active: false, agentStatus: "working", number: 200 }),
      ],
      writesEnabled: true,
    });
    const rootRoute = createRootRoute({
      component: () => (
        <QueryClientProvider client={queryClient}>{createElement(HerdrPage)}</QueryClientProvider>
      ),
    });
    const router = createRouter({
      routeTree: rootRoute,
      history: createMemoryHistory({ initialEntries: ["/herdr"] }),
    });
    await router.load();

    render(<RouterProvider router={router} />);

    expect(
      screen.getAllByLabelText(/^Herdr agent status:/).map((indicator) => ({
        colorClassName: indicator.firstElementChild?.className,
        focusLabel: indicator.parentElement?.querySelector(".sr-only")?.textContent,
        label: indicator.textContent,
      })),
    ).toStrictEqual([
      {
        colorClassName: "h-2.5 w-2.5 rounded-full bg-red-500",
        focusLabel: "Herdr pane focused",
        label: "blocked",
      },
      {
        colorClassName: "h-2.5 w-2.5 rounded-full bg-yellow-500",
        focusLabel: "Herdr pane not focused",
        label: "working",
      },
    ]);
  });

  it("names the page and explains why its tracked Claude session count excludes panes", async () => {
    const HerdrPage = HerdrRoute.options.component;
    if (!HerdrPage) throw new Error("Expected the Herdr route component");

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(terminalPlacementsQueryOptions.queryKey, {
      placements: [
        placement({ active: true, agentStatus: "working", number: 100 }),
        placement({ active: false, agentStatus: "idle", number: 200 }),
      ],
      writesEnabled: true,
    });
    const rootRoute = createRootRoute({
      component: () => (
        <QueryClientProvider client={queryClient}>{createElement(HerdrPage)}</QueryClientProvider>
      ),
    });
    const router = createRouter({
      routeTree: rootRoute,
      history: createMemoryHistory({ initialEntries: ["/herdr"] }),
    });
    await router.load();

    render(<RouterProvider router={router} />);

    const scopeExplanation =
      "This page lists Herdr panes linked to indexed Claude transcripts. It intentionally excludes Codex sessions and shell panes that are not linked to a Claude transcript.";
    expect({
      heading: screen.getByRole("heading", { level: 1 }).textContent,
      count: screen.getByText("2 tracked Claude sessions").textContent,
      scopeExplanation: screen.getByRole("img", { name: scopeExplanation }).getAttribute("title"),
      routeMeta: routeMeta(HerdrRoute),
      terminalRouteMeta: routeMeta(HerdrTerminalRoute),
    }).toStrictEqual({
      heading: "Herdr",
      count: "2 tracked Claude sessions",
      scopeExplanation,
      routeMeta: [{ title: "Herdr" }],
      terminalRouteMeta: [{ title: "Live Herdr terminal" }],
    });
    expect(document.body.textContent?.includes("Terminal Fleet")).toBe(false);
  });

  it("uses Herdr for the live terminal breadcrumb and route metadata", async () => {
    const HerdrTerminalPage = HerdrTerminalRoute.options.component;
    if (!HerdrTerminalPage) throw new Error("Expected the Herdr terminal route component");
    vi.spyOn(HerdrTerminalRoute, "useParams").mockReturnValue({
      sessionId: "session-test-100",
    });

    const rootRoute = createRootRoute({ component: HerdrTerminalPage });
    const router = createRouter({
      routeTree: rootRoute,
      history: createMemoryHistory({ initialEntries: ["/herdr/terminal/session-test-100"] }),
    });
    await router.load();

    render(<RouterProvider router={router} />);

    expect({
      breadcrumb: screen.getByRole("link").textContent,
      breadcrumbHref: screen.getByRole("link").getAttribute("href"),
      heading: screen.getByRole("heading", { level: 1 }).textContent,
      routeMeta: routeMeta(HerdrTerminalRoute),
      terminal: screen.getByRole("region", { name: "Live read-only terminal" }).textContent,
    }).toStrictEqual({
      breadcrumb: "Herdr",
      breadcrumbHref: "/herdr",
      heading: "Live terminal",
      routeMeta: [{ title: "Live Herdr terminal" }],
      terminal: "session-test-100",
    });
    expect(document.body.textContent?.includes("Terminal Fleet")).toBe(false);
  });
});
