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
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { LiveTerminalLink } from "../src/components/session-terminal-links";
import { herdrWorkspacesQueryOptions } from "../src/lib/api/herdr-workspaces";
import { sessionQueryKeys } from "../src/lib/api/sessions";
import { terminalPlacementsQueryOptions } from "../src/lib/api/terminal-placements";
import { updateSessionViewedState } from "../src/lib/api/viewed-state";
import { Route as HerdrLayoutRoute } from "../src/routes/herdr";
import { Route as HerdrRoute } from "../src/routes/herdr.index";
import { Route as HerdrTerminalRoute } from "../src/routes/herdr.terminal.$sessionId";

vi.mock("../src/components/herdr-terminal", () => ({
  HerdrTerminal: ({ sessionId }: { sessionId: string }) => (
    <section aria-label="Live read-only terminal">{sessionId}</section>
  ),
}));

vi.mock("../src/lib/api/viewed-state", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/api/viewed-state")>()),
  updateSessionViewedState: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.mocked(updateSessionViewedState).mockReset();
  vi.restoreAllMocks();
});

const HERDR_ROW_COLUMNS =
  "grid grid-cols-[minmax(0,1fr)_5rem_8.5rem_2rem_9rem] items-center rounded-md border border-border";
const HERDR_TERMINAL_COLUMNS =
  "grid grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-1.5 rounded-md p-3 no-underline transition-colors hover:bg-surface-0/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-100";
const HERDR_TRANSCRIPT_CELL =
  "flex size-8 items-center justify-center justify-self-center rounded-md text-t6 transition-colors hover:bg-surface-0/50 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-100";
const HERDR_ACTION_CELL = "justify-self-end";

function placement({
  active,
  agentStatus,
  displayName,
  newMessageCount = 0,
  number,
  viewedAnywhere = true,
}: {
  active: boolean;
  agentStatus: string;
  displayName?: string;
  newMessageCount?: number;
  number: number;
  viewedAnywhere?: boolean;
}) {
  return {
    provider: "herdr" as const,
    sessionId: `session-test-${number}`,
    displayName: displayName ?? `Terminal ${number}`,
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
        newMessageCount,
        viewedInCcp: viewedAnywhere,
        viewedInHerdr: viewedAnywhere,
        viewedAnywhere,
      },
    },
  };
}

async function renderHerdrPage(placements: ReturnType<typeof placement>[]) {
  const HerdrPage = HerdrRoute.options.component;
  if (!HerdrPage) throw new Error("Expected the Herdr route component");

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(terminalPlacementsQueryOptions.queryKey, {
    placements,
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

  return queryClient;
}

function routeMeta(route: typeof HerdrRoute | typeof HerdrTerminalRoute) {
  const head = route.options.head as () => { meta: Array<{ title: string }> };
  return head().meta;
}

describe("HerdrPage", () => {
  it("shows contextual review actions without zero-count or reviewed-row chrome", async () => {
    await renderHerdrPage([
      placement({
        active: false,
        agentStatus: "done",
        newMessageCount: 3,
        number: 100,
        viewedAnywhere: false,
      }),
      placement({
        active: false,
        agentStatus: "done",
        newMessageCount: 0,
        number: 200,
        viewedAnywhere: false,
      }),
      placement({ active: false, agentStatus: "idle", number: 300, viewedAnywhere: true }),
    ]);

    const positiveCountRow = screen.getByRole("link", {
      name: "Open session transcript for Terminal 100",
    }).parentElement;
    const zeroCountRow = screen.getByRole("link", {
      name: "Open session transcript for Terminal 200",
    }).parentElement;
    const reviewedRow = screen.getByRole("link", {
      name: "Open session transcript for Terminal 300",
    }).parentElement;
    if (!positiveCountRow || !zeroCountRow || !reviewedRow) {
      throw new Error("Expected every Herdr transcript link to have a fleet row");
    }

    expect({
      positiveCount: {
        marker: within(positiveCountRow).getByText("Needs review · 3 new").textContent,
        action: within(positiveCountRow).getByRole("button", { name: "Mark reviewed" }).textContent,
      },
      zeroCount: {
        marker: within(zeroCountRow).getByText("Needs review").textContent,
        action: within(zeroCountRow).getByRole("button", { name: "Mark reviewed" }).textContent,
      },
      reviewed: {
        marker: within(reviewedRow).queryByText(/Needs review/),
        markReviewedAction: within(reviewedRow).queryByRole("button", {
          name: "Mark reviewed",
        }),
        markUnreviewedAction: within(reviewedRow).queryByRole("button", {
          name: "Mark unreviewed",
        }),
      },
      zeroNewCopy: screen.queryByText(/0 new/),
      markUnreviewedActions: screen.queryAllByRole("button", { name: "Mark unreviewed" }),
    }).toStrictEqual({
      positiveCount: { marker: "Needs review · 3 new", action: "Mark reviewed" },
      zeroCount: { marker: "Needs review", action: "Mark reviewed" },
      reviewed: { marker: null, markReviewedAction: null, markUnreviewedAction: null },
      zeroNewCopy: null,
      markUnreviewedActions: [],
    });
  });

  it("gives every row the same fixed columns so only the title is variable-width", async () => {
    await renderHerdrPage([
      placement({
        active: true,
        agentStatus: "working",
        displayName: "✳ Teammate availability notification",
        newMessageCount: 2,
        number: 100,
        viewedAnywhere: false,
      }),
      placement({ active: false, agentStatus: "idle", displayName: "✓ kalshi", number: 200 }),
      placement({
        active: false,
        agentStatus: "done",
        displayName: "claude-code-plans",
        number: 300,
      }),
    ]);

    const rows = ["✳ Teammate availability notification", "✓ kalshi", "claude-code-plans"].map(
      (displayName) => {
        const row = screen.getByRole("link", {
          name: `Open live read-only terminal for ${displayName}`,
        }).parentElement;
        if (!row) throw new Error(`Expected a fleet row for ${displayName}`);
        return row;
      },
    );

    expect(
      rows.map((row) => {
        const [terminal, status, review, transcript, action] = Array.from(row.children);
        const [, glyph, title] = Array.from(terminal?.children ?? []);
        return {
          rowColumns: row.className,
          cells: row.children.length,
          terminalColumns: terminal?.className,
          glyph: glyph?.textContent,
          title: title?.textContent,
          status: status?.getAttribute("aria-label"),
          review: review?.textContent,
          transcript: transcript?.getAttribute("aria-label"),
          actionCell: action?.className,
        };
      }),
    ).toStrictEqual([
      {
        rowColumns: HERDR_ROW_COLUMNS,
        cells: 5,
        terminalColumns: HERDR_TERMINAL_COLUMNS,
        glyph: "✳",
        title: "Teammate availability notification",
        status: "Herdr agent status: working",
        review: "Needs review · 2 new",
        transcript: "Open session transcript for ✳ Teammate availability notification",
        actionCell: HERDR_ACTION_CELL,
      },
      {
        rowColumns: HERDR_ROW_COLUMNS,
        cells: 5,
        terminalColumns: HERDR_TERMINAL_COLUMNS,
        glyph: "✓",
        title: "kalshi",
        status: "Herdr agent status: idle",
        review: "",
        transcript: "Open session transcript for ✓ kalshi",
        actionCell: HERDR_ACTION_CELL,
      },
      {
        rowColumns: HERDR_ROW_COLUMNS,
        cells: 5,
        terminalColumns: HERDR_TERMINAL_COLUMNS,
        glyph: "",
        title: "claude-code-plans",
        status: "Herdr agent status: done",
        review: "",
        transcript: "Open session transcript for claude-code-plans",
        actionCell: HERDR_ACTION_CELL,
      },
    ]);
  });

  it("marks an unseen session reviewed and invalidates its fleet and detail queries", async () => {
    vi.mocked(updateSessionViewedState).mockResolvedValue({
      currentMessageIndex: 100,
      lastViewedMessageIndex: 100,
      reviewTargetMessageIndex: 100,
      newMessageCount: 0,
      viewedInCcp: true,
      viewedInHerdr: true,
      viewedAnywhere: true,
    });
    const queryClient = await renderHerdrPage([
      placement({
        active: false,
        agentStatus: "done",
        newMessageCount: 3,
        number: 100,
        viewedAnywhere: false,
      }),
    ]);
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();

    fireEvent.click(screen.getByRole("button", { name: "Mark reviewed" }));

    await waitFor(() =>
      expect({
        marker: screen.queryByText(/Needs review/),
        action: screen.queryByRole("button", { name: "Mark reviewed" }),
        updateCalls: vi.mocked(updateSessionViewedState).mock.calls,
        invalidationCalls: invalidateQueries.mock.calls,
      }).toStrictEqual({
        marker: null,
        action: null,
        updateCalls: [["session-test-100", "reviewed", 100]],
        invalidationCalls: [
          [{ queryKey: ["terminal", "placements"] }],
          [{ queryKey: sessionQueryKeys.detail("session-test-100") }],
        ],
      }),
    );
  });

  it("shows a retryable error when marking an unseen session reviewed fails", async () => {
    vi.mocked(updateSessionViewedState)
      .mockRejectedValueOnce(new Error("fabricated review failure"))
      .mockResolvedValueOnce({
        currentMessageIndex: 100,
        lastViewedMessageIndex: 100,
        reviewTargetMessageIndex: 100,
        newMessageCount: 0,
        viewedInCcp: true,
        viewedInHerdr: true,
        viewedAnywhere: true,
      });
    const queryClient = await renderHerdrPage([
      placement({
        active: false,
        agentStatus: "done",
        number: 100,
        viewedAnywhere: false,
      }),
    ]);
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();

    fireEvent.click(screen.getByRole("button", { name: "Mark reviewed" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Failed to mark reviewed");
    expect({
      retryAction: screen.getByRole("button", { name: "Retry mark reviewed" }).textContent,
      invalidationCalls: invalidateQueries.mock.calls,
    }).toStrictEqual({ retryAction: "Retry mark reviewed", invalidationCalls: [] });

    fireEvent.click(screen.getByRole("button", { name: "Retry mark reviewed" }));

    await waitFor(() =>
      expect({
        error: screen.queryByRole("alert"),
        action: screen.queryByRole("button", { name: /mark reviewed/i }),
        updateCalls: vi.mocked(updateSessionViewedState).mock.calls,
        invalidationCalls: invalidateQueries.mock.calls,
      }).toStrictEqual({
        error: null,
        action: null,
        updateCalls: [
          ["session-test-100", "reviewed", 100],
          ["session-test-100", "reviewed", 100],
        ],
        invalidationCalls: [
          [{ queryKey: ["terminal", "placements"] }],
          [{ queryKey: sessionQueryKeys.detail("session-test-100") }],
        ],
      }),
    );
  });

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

  it("makes transcript and live terminal navigation distinct without visible technical metadata", async () => {
    const HerdrPage = HerdrRoute.options.component;
    if (!HerdrPage) throw new Error("Expected the Herdr route component");

    const displayName = "* ✓ $ Alice terminal";
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(terminalPlacementsQueryOptions.queryKey, {
      placements: [placement({ active: true, agentStatus: "working", displayName, number: 100 })],
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

    const transcriptLink = screen.getByRole("link", {
      name: `Open session transcript for ${displayName}`,
    });
    const terminalLink = screen.getByRole("link", {
      name: `Open live read-only terminal for ${displayName}`,
    });
    const row = transcriptLink.parentElement;
    expect({
      transcript: {
        href: transcriptLink.getAttribute("href"),
        title: transcriptLink.getAttribute("title"),
        className: transcriptLink.className,
      },
      terminal: {
        href: terminalLink.getAttribute("href"),
        title: terminalLink.getAttribute("title"),
        className: terminalLink.className,
      },
      displayName: Array.from(terminalLink.children).map((cell) => cell.textContent),
      visibleTechnicalMetadata: {
        provider: row?.textContent?.includes("herdr"),
        workspaceId: row?.textContent?.includes("workspace-test-100"),
        paneId: row?.textContent?.includes("pane-test-100"),
        terminalId: row?.textContent?.includes("terminal-test-100"),
        capabilityBadges: ["write", "events", "observe"].filter((label) =>
          Array.from(row?.querySelectorAll("span") ?? []).some(
            (element) => element.textContent === label,
          ),
        ),
      },
    }).toStrictEqual({
      transcript: {
        href: "/session/session-test-100",
        title: `Open session transcript for ${displayName}`,
        className: HERDR_TRANSCRIPT_CELL,
      },
      terminal: {
        href: "/herdr/terminal/session-test-100",
        title: `Open live read-only terminal for ${displayName}. Workspace workspace-test-100 · Pane pane-test-100 · Terminal terminal-test-100 · Capabilities: write, events, observe`,
        className: HERDR_TERMINAL_COLUMNS,
      },
      displayName: ["Herdr pane focused", "*", "✓ $ Alice terminal"],
      visibleTechnicalMetadata: {
        provider: false,
        workspaceId: false,
        paneId: false,
        terminalId: false,
        capabilityBadges: [],
      },
    });
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

    const breadcrumb = screen.getByRole("link", { name: "Herdr" });
    expect({
      breadcrumb: breadcrumb.textContent,
      breadcrumbHref: breadcrumb.getAttribute("href"),
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

/**
 * The live terminal and the transcript are two views of the same Claude
 * session, so each one links to the other. The transcript side is conditional:
 * `/api/herdr/observe` throws when no live pane is linked to the session, so a
 * finished session must not offer a terminal link that lands on an error page.
 */
describe("session and live terminal two-way navigation", () => {
  async function renderWithRouter(element: React.ReactNode, path: string) {
    const rootRoute = createRootRoute({ component: () => element });
    const router = createRouter({
      routeTree: rootRoute,
      history: createMemoryHistory({ initialEntries: [path] }),
    });
    await router.load();
    render(<RouterProvider router={router} />);
  }

  it("links the live terminal page back to the same session's transcript", async () => {
    const HerdrTerminalPage = HerdrTerminalRoute.options.component;
    if (!HerdrTerminalPage) throw new Error("Expected the Herdr terminal route component");
    vi.spyOn(HerdrTerminalRoute, "useParams").mockReturnValue({
      sessionId: "session-test-100",
    });

    await renderWithRouter(createElement(HerdrTerminalPage), "/herdr/terminal/session-test-100");

    const transcriptLink = screen.getByRole("link", {
      name: "Open session transcript for session-test-100",
    });
    expect({
      href: transcriptLink.getAttribute("href"),
      title: transcriptLink.getAttribute("title"),
    }).toStrictEqual({
      href: "/session/session-test-100",
      title: "Open session transcript for session-test-100",
    });
  });

  it("offers the terminal link only while the session has a live herdr pane", async () => {
    await renderWithRouter(
      <>
        <LiveTerminalLink sessionId="session-test-100" sessionTitle="Alice" hasLivePane={true} />
        <LiveTerminalLink sessionId="session-test-200" sessionTitle="Bob" hasLivePane={false} />
      </>,
      "/session/session-test-100",
    );

    const terminalLink = screen.getByRole("link", {
      name: "Open live read-only terminal for Alice",
    });
    expect({
      href: terminalLink.getAttribute("href"),
      title: terminalLink.getAttribute("title"),
      withoutLivePane: screen.queryByRole("link", {
        name: "Open live read-only terminal for Bob",
      }),
    }).toStrictEqual({
      href: "/herdr/terminal/session-test-100",
      title: "Open live read-only terminal for Alice",
      withoutLivePane: null,
    });
  });
});

/**
 * Flat file routing nests `herdr.index` and `herdr.terminal.$sessionId` under
 * `herdr`, so the layout has to hand rendering down through `<Outlet />`. This
 * exact regression shipped once: the URL and title changed while the child
 * never mounted and the parent rendered in its place.
 */
describe("Herdr master-detail layout", () => {
  function renderLayoutAt(path: string) {
    const HerdrLayout = HerdrLayoutRoute.options.component;
    const HerdrIndex = HerdrRoute.options.component;
    const HerdrTerminal = HerdrTerminalRoute.options.component;
    if (!HerdrLayout || !HerdrIndex || !HerdrTerminal) {
      throw new Error("Expected every Herdr route to declare a component");
    }

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(terminalPlacementsQueryOptions.queryKey, {
      placements: [placement({ active: false, agentStatus: "idle", number: 100 })],
      writesEnabled: true,
    });
    queryClient.setQueryData(herdrWorkspacesQueryOptions.queryKey, {
      workspaces: [
        {
          workspaceId: "workspace-test-100",
          number: 1,
          label: "kalshi",
          agentStatus: "idle",
          worktreeName: null,
          agentPanes: [
            {
              paneId: "pane-test-100",
              title: "Terminal 100",
              agent: "claude",
              agentStatus: "idle",
              sessionId: "session-test-100",
            },
          ],
          shellPanes: [],
        },
      ],
    });

    const rootRoute = createRootRoute({
      component: () => (
        <QueryClientProvider client={queryClient}>
          <Outlet />
        </QueryClientProvider>
      ),
    });
    const layoutRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/herdr",
      component: HerdrLayout,
    });
    const indexRoute = createRoute({
      getParentRoute: () => layoutRoute,
      path: "/",
      component: HerdrIndex,
    });
    const terminalRoute = createRoute({
      getParentRoute: () => layoutRoute,
      path: "/terminal/$sessionId",
      component: HerdrTerminal,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([layoutRoute.addChildren([indexRoute, terminalRoute])]),
      history: createMemoryHistory({ initialEntries: [path] }),
    });
    return { router };
  }

  it("shows the flat list beside the rail at the index", async () => {
    const { router } = renderLayoutAt("/herdr");
    await router.load();
    render(<RouterProvider router={router} />);

    expect({
      rail: screen.getByRole("navigation", { name: "Herdr workspaces" }).textContent,
      list: screen.getByRole("heading", { level: 1 }).textContent,
      terminal: screen.queryByRole("region", { name: "Live read-only terminal" }),
    }).toStrictEqual({ rail: "1kalshiidleTerminal 100idle", list: "Herdr", terminal: null });
  });

  /**
   * The rail and the flat list show the same panes, so clicking a pane in one
   * has to land where clicking it in the other does. They disagreed once: the
   * rail opened the live terminal while the list row opened the transcript.
   */
  it("sends the rail and the flat list to the same view for one pane", async () => {
    const { router } = renderLayoutAt("/herdr");
    await router.load();
    render(<RouterProvider router={router} />);

    const transcriptLink = screen.getByRole("link", {
      name: "Open session transcript for Terminal 100",
    });
    const [rowPrimary] = Array.from(transcriptLink.parentElement?.children ?? []);
    expect({
      rail: screen
        .getByRole("link", { name: "Open live terminal for Terminal 100 in workspace kalshi" })
        .getAttribute("href"),
      rowPrimary: rowPrimary?.getAttribute("href"),
      rowPrimaryLabel: rowPrimary?.getAttribute("aria-label"),
      rowSecondary: transcriptLink.getAttribute("href"),
    }).toStrictEqual({
      rail: "/herdr/terminal/session-test-100",
      rowPrimary: "/herdr/terminal/session-test-100",
      rowPrimaryLabel: "Open live read-only terminal for Terminal 100",
      rowSecondary: "/session/session-test-100",
    });
  });

  it("renders the pane detail through the outlet on a deep link, keeping the rail", async () => {
    const { router } = renderLayoutAt("/herdr/terminal/session-test-100");
    await router.load();
    render(<RouterProvider router={router} />);

    expect({
      rail: screen.getByRole("navigation", { name: "Herdr workspaces" }).getAttribute("aria-label"),
      selectedRailLink: screen
        .getByRole("link", { name: "Open live terminal for Terminal 100 in workspace kalshi" })
        .getAttribute("aria-current"),
      heading: screen.getByRole("heading", { level: 1 }).textContent,
      terminal: screen.getByRole("region", { name: "Live read-only terminal" }).textContent,
      flatList: screen.queryByText("1 tracked Claude sessions"),
    }).toStrictEqual({
      rail: "Herdr workspaces",
      selectedRailLink: "page",
      heading: "Live terminal",
      terminal: "session-test-100",
      flatList: null,
    });
  });
});
