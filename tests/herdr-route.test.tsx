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
import { afterEach, describe, expect, it } from "vite-plus/test";
import { terminalPlacementsQueryOptions } from "../src/lib/api/terminal-placements";
import { Route as HerdrRoute } from "../src/routes/herdr";

afterEach(cleanup);

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

describe("TerminalFleetPage", () => {
  it("uses Herdr agent state rather than pane focus for each row's status color", async () => {
    const TerminalFleetPage = HerdrRoute.options.component;
    if (!TerminalFleetPage) throw new Error("Expected the Herdr route component");

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
        <QueryClientProvider client={queryClient}>
          {createElement(TerminalFleetPage)}
        </QueryClientProvider>
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
});
