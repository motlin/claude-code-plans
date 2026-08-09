// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { HerdrSubList } from "../src/components/sidebar/sublists/HerdrSubList";
import { terminalPlacementsQueryOptions } from "../src/lib/api/terminal-placements";

afterEach(cleanup);

describe("HerdrSubList", () => {
  it("renders live Herdr terminals and excludes other terminal providers", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(terminalPlacementsQueryOptions.queryKey, {
      placements: [
        {
          provider: "herdr",
          sessionId: "session-test-100",
          displayName: "Alice terminal",
          active: true,
          paneHandle: "pane-test-100",
          scopeHandle: "workspace-test-100",
          capabilities: {
            supportsWrite: true,
            supportsEvents: true,
            supportsObserve: true,
          },
          herdrPane: {
            paneId: "pane-test-100",
            terminalId: "terminal-test-100",
            workspaceId: "workspace-test-100",
            tabId: "tab-test-100",
            focused: true,
            cwd: "/tmp/test/alice-project",
            foregroundCwd: "/tmp/test/alice-project",
            agentStatus: "working",
            agent: "claude",
            terminalTitle: "Alice terminal",
            agentSessionId: "session-test-100",
            revision: 100,
            sessionId: "session-test-100",
            via: "both",
            viewedState: {
              currentMessageIndex: 100,
              lastViewedMessageIndex: 100,
              reviewTargetMessageIndex: 100,
              newMessageCount: 0,
              viewedInCcp: true,
              viewedInHerdr: true,
              viewedAnywhere: true,
            },
          },
        },
        {
          provider: "tmux",
          sessionId: "session-test-200",
          displayName: "Bob tmux window",
          active: true,
          paneHandle: "pane-test-200",
          scopeHandle: "workspace-test-200",
          capabilities: {
            supportsWrite: false,
            supportsEvents: false,
            supportsObserve: false,
          },
          tmuxWindow: {
            sessionId: "session-test-200",
            projectName: "bob-project",
            windowIndex: 200,
            windowName: "Bob tmux window",
            windowActive: true,
            tmuxPane: "pane-test-200",
            socket: "/tmp/test/tmux-test-200.sock",
          },
        },
        {
          provider: "herdr",
          sessionId: "session-test-300",
          displayName: "Charlie terminal",
          active: false,
          paneHandle: "pane-test-300",
          scopeHandle: "workspace-test-300",
          capabilities: {
            supportsWrite: true,
            supportsEvents: true,
            supportsObserve: true,
          },
          herdrPane: {
            paneId: "pane-test-300",
            terminalId: "terminal-test-300",
            workspaceId: "workspace-test-300",
            tabId: "tab-test-300",
            focused: false,
            cwd: "/tmp/test/charlie-project",
            foregroundCwd: null,
            agentStatus: "idle",
            agent: "claude",
            terminalTitle: "Charlie terminal",
            agentSessionId: "session-test-300",
            revision: 300,
            sessionId: "session-test-300",
            via: "agent-session",
            viewedState: {
              currentMessageIndex: 300,
              lastViewedMessageIndex: 299,
              reviewTargetMessageIndex: 300,
              newMessageCount: 1,
              viewedInCcp: false,
              viewedInHerdr: false,
              viewedAnywhere: false,
            },
          },
        },
      ],
      writesEnabled: false,
    });
    const rootRoute = createRootRoute({
      component: () => (
        <QueryClientProvider client={queryClient}>
          <HerdrSubList activeItemId="session-test-300" />
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
      screen.getAllByRole("link").map((link) => ({
        className: link.className,
        href: link.getAttribute("href"),
        label: link.textContent,
      })),
    ).toStrictEqual([
      {
        className:
          "mb-px flex items-center gap-2 rounded-[4px] px-2 py-1 text-xs no-underline transition-colors text-text-500 hover:bg-bg-300/50 hover:text-text-200",
        href: "/herdr/terminal/session-test-100",
        label: "Alice terminal",
      },
      {
        className:
          "mb-px flex items-center gap-2 rounded-[4px] px-2 py-1 text-xs no-underline transition-colors bg-bg-300/50 font-medium text-text-000",
        href: "/herdr/terminal/session-test-300",
        label: "Charlie terminal",
      },
    ]);
  });
});
