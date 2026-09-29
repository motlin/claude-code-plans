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
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { HomeLanding } from "../src/components/home/home-landing";
import { PullRequestsSection } from "../src/components/home/pull-requests-section";
import { approvalsQueryOptions } from "../src/lib/api/approvals";
import { homeDismissalsQueryOptions } from "../src/lib/api/home-dismissals";
import { localAccountQueryOptions } from "../src/lib/api/local-account";
import { recentSessionsInfiniteQueryOptions, type SessionListItem } from "../src/lib/api/sessions";
import { selectHomePrs, type HomePrSource } from "../src/lib/home-prs";

const MINUTE = 60 * 1000;
const NOW = new Date(2026, 8, 29, 12, 0).getTime();

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function source(n: number, overrides: Partial<HomePrSource["pr"]> = {}): HomePrSource {
  return {
    sessionId: `s${n}`,
    sessionTitle: `Session ${n}`,
    lastActivityAt: NOW - n * MINUTE,
    pr: {
      number: n,
      state: "open",
      url: `https://github.com/alice/widgets/pull/${n}`,
      title: `PR ${n}`,
      ...overrides,
    },
  };
}

function rowTexts(): string[][] {
  return within(screen.getByRole("region", { name: "Pull requests" }))
    .getAllByRole("listitem")
    .map((item) =>
      [
        ...item.querySelectorAll(
          "[data-pill-label], [data-row-title], [data-row-number], [data-row-repo]",
        ),
      ].map((node) => node.textContent ?? ""),
    );
}

describe("PullRequestsSection", () => {
  it("renders pills, titles, numbers and repos, capped with Show N more", () => {
    render(
      <PullRequestsSection
        rows={selectHomePrs([
          source(1),
          source(2, { checks: { passed: 1, failed: 1, pending: 0 } }),
          source(3, { review: "APPROVED" }),
          source(4),
        ])}
        rowLimit={3}
        now={NOW}
        onOpen={() => undefined}
      />,
    );

    const region = screen.getByRole("region", { name: "Pull requests" });
    expect({
      rows: rowTexts(),
      more: within(region).getByRole("button", { name: "Show 1 more" }).textContent,
      dot: region.querySelector("li [data-pill-dot]")?.getAttribute("style"),
    }).toStrictEqual({
      rows: [
        ["CI failing", "PR 2", "#2", "alice/widgets"],
        ["Ready to merge", "PR 3", "#3", "alice/widgets"],
        ["Ready for review", "PR 1", "#1", "alice/widgets"],
      ],
      more: "Show 1 more",
      dot: "background-color: var(--color-diff-removed);",
    });
  });

  it("opens the session on click and the PR in a new tab on ⌘/Ctrl-click", () => {
    const onOpen = vi.fn<(sessionId: string) => void>();
    const open = vi.fn();
    vi.stubGlobal("open", open);
    render(
      <PullRequestsSection
        rows={selectHomePrs([source(7)])}
        rowLimit={3}
        now={NOW}
        onOpen={onOpen}
      />,
    );

    const button = screen.getByRole("button", { name: "Open session for PR 7" });
    fireEvent.click(button);
    fireEvent.click(button, { metaKey: true });
    fireEvent.click(button, { ctrlKey: true });

    expect({ sessions: onOpen.mock.calls, tabs: open.mock.calls }).toStrictEqual({
      sessions: [["s7"]],
      tabs: [
        ["https://github.com/alice/widgets/pull/7", "_blank", "noopener,noreferrer"],
        ["https://github.com/alice/widgets/pull/7", "_blank", "noopener,noreferrer"],
      ],
    });
  });

  it("renders nothing without rows", () => {
    const { container } = render(
      <PullRequestsSection rows={[]} rowLimit={3} now={NOW} onOpen={() => undefined} />,
    );
    expect(container.innerHTML).toBe("");
  });
});

describe("HomeLanding pull requests", () => {
  it("shows open PRs instead of the stats card when no session needs attention", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("{}", { status: 404 }))),
    );
    const session: SessionListItem = {
      id: "busy",
      title: "Busy session",
      mtime: new Date(Date.now() - 5 * MINUTE).toISOString(),
      created: new Date(Date.now() - 60 * MINUTE).toISOString(),
      project: "-projects-alpha",
      projectName: "alpha",
      messageCount: 4,
      archived: false,
      state: "working",
      bucket: "working",
      liveAgentCount: 0,
      unseen: false,
      blockedSince: null,
      prStatus: {
        number: 12,
        state: "open",
        url: "https://github.com/alice/widgets/pull/12",
        title: "Add widgets",
        checks: { passed: 1, failed: 0, pending: 2 },
        review: null,
      },
    };
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    queryClient.setQueryData(recentSessionsInfiniteQueryOptions().queryKey, {
      pages: [{ sessions: [session], nextCursor: null }],
      pageParams: [null],
    });
    queryClient.setQueryData(approvalsQueryOptions().queryKey, { approvals: [] });
    queryClient.setQueryData(homeDismissalsQueryOptions.queryKey, { dismissals: {} });
    queryClient.setQueryData(localAccountQueryOptions.queryKey, {
      name: "Craig Motlin",
      firstName: "Craig",
      initial: "C",
    });

    const rootRoute = createRootRoute({
      component: () => (
        <QueryClientProvider client={queryClient}>
          <Outlet />
        </QueryClientProvider>
      ),
    });
    const homeRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/",
      component: () => <HomeLanding />,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([homeRoute]),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    await router.load();
    render(<RouterProvider router={router} />);

    await screen.findByRole("region", { name: "Pull requests" });
    expect({
      rows: rowTexts(),
      stats: screen.queryByRole("region", { name: "Usage stats" }),
      sessions: screen.queryByRole("region", { name: "Sessions" }),
    }).toStrictEqual({
      rows: [["CI 1/3", "Add widgets", "#12", "alice/widgets"]],
      stats: null,
      sessions: null,
    });
  });
});
