// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";

import { AttentionSection } from "../src/components/home/attention-section";
import { HomeSessionsSection } from "../src/components/home/home-sessions-section";
import { approvalsQueryOptions } from "../src/lib/api/approvals";
import { homeDismissalsQueryOptions } from "../src/lib/api/home-dismissals";
import { recentSessionsInfiniteQueryOptions, type SessionListItem } from "../src/lib/api/sessions";
import { useViewportRowLimit } from "../src/hooks/use-viewport-row-limit";
import type { HomeAttentionItem, HomeAttentionRow } from "../src/lib/home-attention";
import { selectHomeAttention } from "../src/lib/home-attention";

const MINUTE = 60 * 1000;
const NOW = new Date(2026, 8, 29, 12, 0).getTime();

function row(sessionId: string, overrides: Partial<HomeAttentionRow> = {}): HomeAttentionRow {
  return {
    sessionId,
    title: `Title ${sessionId}`,
    bucket: "blocked",
    project: "alpha",
    archived: false,
    createdAt: NOW - 60 * MINUTE,
    lastActivityAt: NOW - MINUTE,
    pendingApproval: null,
    statusDetail: null,
    lastAssistantText: null,
    ...overrides,
  };
}

function items(rows: HomeAttentionRow[]): HomeAttentionItem<HomeAttentionRow>[] {
  return selectHomeAttention({ rows, pinnedIds: new Set(), dismissed: {}, now: NOW });
}

function rowTitles(): string[] {
  return screen
    .queryAllByRole("listitem")
    .map((li) => li.querySelector("[data-row-main-button]")?.getAttribute("aria-label") ?? "");
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AttentionSection", () => {
  it("renders the upstream Sessions markup with pills, status line, project, time and dismiss", () => {
    render(
      <AttentionSection
        items={items([
          row("blocked", {
            title: "Termius SSH login",
            pendingApproval: { toolName: "AskUserQuestion" },
            lastActivityAt: NOW - 47 * MINUTE,
          }),
          row("review", {
            bucket: "review",
            title: "Refactor parser",
            project: null,
            lastActivityAt: NOW - 20 * 1000,
          }),
        ])}
        rowLimit={5}
        now={NOW}
        onOpen={() => undefined}
        onDismiss={() => undefined}
      />,
    );

    const section = screen.getByRole("region", { name: "Sessions" });
    const list = within(section).getByRole("list");
    const rows = within(list)
      .getAllByRole("listitem")
      .map((li) => {
        const main = li.querySelector("[data-row-main-button]");
        return {
          kind: li.getAttribute("data-kind"),
          label: main?.getAttribute("aria-label"),
          dotClass: li.querySelector("[data-pill-dot]")?.className,
          pill: li.querySelector("[data-pill-label]")?.textContent,
          pillClass: li.querySelector("[data-pill-label]")?.className,
          title: li.querySelector("[data-row-title]")?.textContent,
          status: li.querySelector("[data-row-status]")?.textContent ?? null,
          project: li.querySelector("[data-row-project]")?.textContent ?? null,
          time: li.querySelector("time")?.textContent,
          datetime: li.querySelector("time")?.getAttribute("datetime"),
          dismiss: within(li)
            .getByRole("button", { name: "Dismiss session" })
            .hasAttribute("data-row-dismiss"),
        };
      });

    expect({
      heading: within(section).getByRole("heading", { level: 2 }).textContent,
      showMore: within(section).queryByRole("button", { name: /Show/ }),
      rows,
    }).toStrictEqual({
      heading: "Sessions",
      showMore: null,
      rows: [
        {
          kind: "blocked",
          label: "Open session Termius SSH login",
          dotClass: "size-[5px] rounded-full bg-[var(--status-dot-awaiting)]",
          pill: "Needs input",
          pillClass: "whitespace-nowrap text-[12px] leading-[15px] text-warning-000",
          title: "Termius SSH login",
          status: "Waiting on permission: AskUserQuestion",
          project: "alpha",
          time: "47m ago",
          datetime: new Date(NOW - 47 * MINUTE).toISOString(),
          dismiss: true,
        },
        {
          kind: "review",
          label: "Open session Refactor parser",
          dotClass: "size-[5px] rounded-full bg-accent-100",
          pill: "Ready for review",
          pillClass: "whitespace-nowrap text-[12px] leading-[15px] text-accent-100",
          title: "Refactor parser",
          status: null,
          project: null,
          time: "now",
          datetime: new Date(NOW - 20 * 1000).toISOString(),
          dismiss: true,
        },
      ],
    });
  });

  it("falls back to Untitled session and opens the session from the main button", () => {
    const onOpen = vi.fn();
    render(
      <AttentionSection
        items={items([row("s1", { title: "" })])}
        rowLimit={5}
        now={NOW}
        onOpen={onOpen}
        onDismiss={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open session Untitled session" }));

    expect(onOpen.mock.calls).toStrictEqual([["s1"]]);
  });

  it("renders nothing when no session needs attention", () => {
    const { container } = render(
      <AttentionSection
        items={[]}
        rowLimit={5}
        now={NOW}
        onOpen={() => undefined}
        onDismiss={() => undefined}
      />,
    );

    expect(container.innerHTML).toBe("");
  });

  it("caps the rows and toggles Show N more / Show less", () => {
    const all = items(
      ["a", "b", "c", "d", "e"].map((id, index) =>
        row(id, { lastActivityAt: NOW - (index + 1) * MINUTE }),
      ),
    );
    render(
      <AttentionSection
        items={all}
        rowLimit={3}
        now={NOW}
        onOpen={() => undefined}
        onDismiss={() => undefined}
      />,
    );

    const capped = {
      rows: rowTitles(),
      expanded: screen.getByRole("button", { name: "Show 2 more" }).getAttribute("aria-expanded"),
    };
    fireEvent.click(screen.getByRole("button", { name: "Show 2 more" }));
    const uncapped = {
      rows: rowTitles(),
      expanded: screen.getByRole("button", { name: "Show less" }).getAttribute("aria-expanded"),
    };
    fireEvent.click(screen.getByRole("button", { name: "Show less" }));

    expect({ capped, uncapped, collapsedAgain: rowTitles() }).toStrictEqual({
      capped: {
        rows: ["Open session Title a", "Open session Title b", "Open session Title c"],
        expanded: "false",
      },
      uncapped: {
        rows: [
          "Open session Title a",
          "Open session Title b",
          "Open session Title c",
          "Open session Title d",
          "Open session Title e",
        ],
        expanded: "true",
      },
      collapsedAgain: ["Open session Title a", "Open session Title b", "Open session Title c"],
    });
  });

  it("dismiss removes the row and moves focus to the next row's dismiss, else the heading", () => {
    const onDismiss = vi.fn();
    function Harness() {
      const [dismissed, setDismissed] = useState<Record<string, number>>({});
      const rows = [row("a"), row("b", { lastActivityAt: NOW - 2 * MINUTE })];
      return (
        <AttentionSection
          items={selectHomeAttention({ rows, pinnedIds: new Set(), dismissed, now: NOW })}
          rowLimit={5}
          now={NOW}
          onOpen={() => undefined}
          onDismiss={(item) => {
            onDismiss(item.session.sessionId, item.kind);
            setDismissed((previous) => ({ ...previous, [item.session.sessionId]: NOW }));
          }}
        />
      );
    }
    render(<Harness />);

    const [firstDismiss] = screen.getAllByRole("button", { name: "Dismiss session" });
    if (!firstDismiss) throw new Error("expected a dismiss button");
    fireEvent.click(firstDismiss);
    const afterFirst = {
      rows: rowTitles(),
      focused: document.activeElement?.closest("li")?.getAttribute("data-session-id") ?? null,
      focusedLabel: document.activeElement?.getAttribute("aria-label"),
    };

    fireEvent.click(screen.getByRole("button", { name: "Dismiss session" }));
    const afterSecond = {
      rows: rowTitles(),
      section: screen.queryByRole("region", { name: "Sessions" }),
    };

    expect({ afterFirst, afterSecond, calls: onDismiss.mock.calls }).toStrictEqual({
      afterFirst: {
        rows: ["Open session Title b"],
        focused: "b",
        focusedLabel: "Dismiss session",
      },
      afterSecond: { rows: [], section: null },
      calls: [
        ["a", "blocked"],
        ["b", "blocked"],
      ],
    });
  });

  it("moves focus to the Sessions heading when the last remaining row below is gone", () => {
    function Harness() {
      const [dismissed, setDismissed] = useState<Record<string, number>>({});
      const rows = [row("a"), row("b", { lastActivityAt: NOW - 2 * MINUTE })];
      return (
        <AttentionSection
          items={selectHomeAttention({ rows, pinnedIds: new Set(), dismissed, now: NOW })}
          rowLimit={5}
          now={NOW}
          onOpen={() => undefined}
          onDismiss={(item) =>
            setDismissed((previous) => ({ ...previous, [item.session.sessionId]: NOW }))
          }
        />
      );
    }
    render(<Harness />);

    const dismissButtons = screen.getAllByRole("button", { name: "Dismiss session" });
    const last = dismissButtons[dismissButtons.length - 1];
    if (!last) throw new Error("expected a dismiss button");
    fireEvent.click(last);

    expect({
      rows: rowTitles(),
      focused: document.activeElement === screen.getByRole("heading", { level: 2 }),
    }).toStrictEqual({ rows: ["Open session Title a"], focused: true });
  });
});

describe("useViewportRowLimit", () => {
  function stubViewportHeight(initialHeight: number) {
    let height = initialHeight;
    const listeners = new Set<() => void>();
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => {
        const minHeight = Number(/min-height:\s*(\d+)px/.exec(query)?.[1]);
        return {
          get matches() {
            return height >= minHeight;
          },
          media: query,
          addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
          removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
        };
      }),
    );
    return (next: number) => {
      height = next;
      for (const listener of listeners) listener();
    };
  }

  it("is 3 plus one per matched 800/900/1000/1100px min-height, following viewport changes", () => {
    const resize = stubViewportHeight(700);
    const { result } = renderHook(() => useViewportRowLimit());
    const seen = [result.current];
    for (const height of [800, 900, 1000, 1100, 850]) {
      act(() => resize(height));
      seen.push(result.current);
    }

    expect(seen).toStrictEqual([3, 4, 5, 6, 7, 4]);
  });
});

describe("HomeSessionsSection", () => {
  function listItem(id: string, overrides: Partial<SessionListItem> = {}): SessionListItem {
    return {
      id,
      title: `Title ${id}`,
      mtime: new Date(Date.now() - 5 * MINUTE).toISOString(),
      created: new Date(Date.now() - 60 * MINUTE).toISOString(),
      project: "-projects-alpha",
      projectName: "alpha",
      messageCount: 4,
      archived: false,
      state: "waiting",
      bucket: "blocked",
      liveAgentCount: 0,
      unseen: false,
      blockedSince: null,
      ...overrides,
    };
  }

  it("shows blocked and review sessions, skips dismissed ones, and persists a dismissal", async () => {
    const dismissedAt = { hidden: Date.now() - 10 * MINUTE };
    const fetchMock = vi.fn((_input: string, _init?: RequestInit) =>
      Promise.resolve(Response.json({ dismissals: { ...dismissedAt, waiting: Date.now() } })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    queryClient.setQueryData(recentSessionsInfiniteQueryOptions().queryKey, {
      pages: [
        {
          sessions: [
            listItem("waiting"),
            listItem("finished", { bucket: "review", state: "ended", unseen: true }),
            listItem("working", { bucket: "working", state: "working" }),
            listItem("hidden", { mtime: new Date(Date.now() - 30 * MINUTE).toISOString() }),
          ],
          nextCursor: null,
        },
      ],
      pageParams: [null],
    });
    queryClient.setQueryData(approvalsQueryOptions().queryKey, {
      approvals: [
        {
          sessionId: "waiting",
          projectId: "-projects-alpha",
          projectName: "alpha",
          toolName: "ExitPlanMode",
          toolUseId: "toolu_1",
          blockedSince: new Date().toISOString(),
          planFilename: null,
          questionPreview: null,
        },
      ],
    });
    queryClient.setQueryData(homeDismissalsQueryOptions.queryKey, { dismissals: dismissedAt });
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
      component: HomeSessionsSection,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([homeRoute]),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    await router.load();
    render(<RouterProvider router={router} />);

    await screen.findByRole("region", { name: "Sessions" });
    const before = {
      rows: rowTitles(),
      status: screen.getAllByRole("listitem")[0]?.querySelector("[data-row-status]")?.textContent,
    };
    const [firstDismiss] = screen.getAllByRole("button", { name: "Dismiss session" });
    if (!firstDismiss) throw new Error("expected a dismiss button");
    fireEvent.click(firstDismiss);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect({
      before,
      after: rowTitles(),
      request: fetchMock.mock.calls.map(([url, init]) => ({
        url,
        method: init?.method,
        body: init?.body,
      })),
    }).toStrictEqual({
      before: {
        rows: ["Open session Title waiting", "Open session Title finished"],
        status: "Waiting on permission: ExitPlanMode",
      },
      after: ["Open session Title finished"],
      request: [
        {
          url: "/api/home/dismissals",
          method: "POST",
          body: JSON.stringify({ sessionId: "waiting" }),
        },
      ],
    });
  });
});
