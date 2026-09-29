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
import { HomeStatsCard } from "../src/components/home/home-stats-card";
import { approvalsQueryOptions } from "../src/lib/api/approvals";
import { homeDismissalsQueryOptions } from "../src/lib/api/home-dismissals";
import { homeStatsQueryOptions, type HomeStatsPayload } from "../src/lib/api/home-stats";
import { localAccountQueryOptions } from "../src/lib/api/local-account";
import { recentSessionsInfiniteQueryOptions } from "../src/lib/api/sessions";
import type { HomeStatsDay } from "../src/lib/home-stats";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function hours(counts: Record<number, number>): number[] {
  return Array.from({ length: 24 }, (_, hour) => counts[hour] ?? 0);
}

const TODAY = "2026-09-29";

const DAYS: HomeStatsDay[] = [
  {
    date: "2026-07-01",
    sessions: 4,
    messages: 120,
    hourCounts: hours({ 9: 4 }),
    tokensByModel: { "claude-opus-4-6": 2_000_000 },
  },
  {
    date: "2026-09-28",
    sessions: 2,
    messages: 30,
    hourCounts: hours({ 15: 2 }),
    tokensByModel: { "claude-haiku-4-5-20251001": 1500, "claude-opus-4-6": 500 },
  },
];

function tiles(): Record<string, string> {
  const card = screen.getByRole("region", { name: "Usage stats" });
  return Object.fromEntries(
    within(card)
      .getAllByRole("group")
      .map((tile) => [
        tile.querySelector("[data-tile-label]")?.textContent ?? "",
        tile.querySelector("[data-tile-value]")?.textContent ?? "",
      ]),
  );
}

describe("HomeStatsCard", () => {
  it("shows the six Overview tiles and re-totals for the chosen range", () => {
    render(<HomeStatsCard days={DAYS} today={TODAY} />);

    const all = tiles();
    fireEvent.click(screen.getByRole("radio", { name: "7d" }));
    const week = tiles();

    expect({
      tabs: screen.getAllByRole("tab").map((tab) => [tab.textContent, tab.ariaSelected]),
      ranges: screen.getAllByRole("radio").map((radio) => radio.textContent),
      all,
      week,
      heatmap: screen.getByRole("img", { name: "Daily activity heatmap" }).style.height,
    }).toStrictEqual({
      tabs: [
        ["Overview", "true"],
        ["Models", "false"],
      ],
      ranges: ["All", "30d", "7d"],
      all: {
        Sessions: "6",
        Messages: "150",
        "Total tokens": "2M",
        "Active days": "2",
        "Peak hour": "9 AM",
        "Favorite model": "Opus 4.6",
      },
      week: {
        Sessions: "2",
        Messages: "30",
        "Total tokens": "2K",
        "Active days": "1",
        "Peak hour": "3 PM",
        "Favorite model": "Haiku 4.5",
      },
      heatmap: "120px",
    });
  });

  it("lists per-model token shares on the Models tab", () => {
    render(<HomeStatsCard days={DAYS} today={TODAY} />);
    fireEvent.click(screen.getByRole("tab", { name: "Models" }));

    const rows = within(screen.getByRole("list", { name: "Models" }))
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    expect(rows).toStrictEqual(["Opus 4.62M tokens99.9%", "Haiku 4.51.5K tokens0.1%"]);
  });

  it("shows a dash for the token tiles when no source knows the tokens", () => {
    render(
      <HomeStatsCard
        days={[
          { date: TODAY, sessions: 1, messages: 3, hourCounts: hours({}), tokensByModel: null },
        ]}
        today={TODAY}
      />,
    );
    const { "Total tokens": total, "Favorite model": favorite } = tiles();
    expect({ total, favorite }).toStrictEqual({ total: "—", favorite: "—" });
  });
});

describe("HomeLanding empty state", () => {
  it("greets with What’s up next and shows the stats card when nothing needs attention", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("{}", { status: 404 }))),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    queryClient.setQueryData(recentSessionsInfiniteQueryOptions().queryKey, {
      pages: [{ sessions: [], nextCursor: null }],
      pageParams: [null],
    });
    queryClient.setQueryData(approvalsQueryOptions().queryKey, { approvals: [] });
    queryClient.setQueryData(homeDismissalsQueryOptions.queryKey, { dismissals: {} });
    queryClient.setQueryData(localAccountQueryOptions.queryKey, {
      name: "Craig Motlin",
      firstName: "Craig",
      initial: "C",
    });
    const payload: HomeStatsPayload = { today: TODAY, days: DAYS };
    queryClient.setQueryData(homeStatsQueryOptions.queryKey, payload);

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

    await screen.findByRole("region", { name: "Usage stats" });
    expect({
      heading: screen.getByRole("heading", { level: 1 }).textContent,
      sessions: screen.queryByRole("region", { name: "Sessions" }),
      sessionsTile: tiles()["Sessions"],
    }).toStrictEqual({
      heading: "What’s up next, Craig?",
      sessions: null,
      sessionsTile: "6",
    });
  });
});
