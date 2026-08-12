// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { HerdrWorkspaceRail } from "../src/components/herdr-workspace-rail";
import {
  herdrWorkspacesQueryOptions,
  type HerdrWorkspaceData,
  type HerdrWorkspacePaneData,
} from "../src/lib/api/herdr-workspaces";

afterEach(cleanup);

function pane(
  overrides: Partial<HerdrWorkspacePaneData> & { paneId: string },
): HerdrWorkspacePaneData {
  return {
    title: `Pane ${overrides.paneId}`,
    agent: null,
    agentStatus: "unknown",
    sessionId: null,
    ...overrides,
  };
}

function workspace(
  overrides: Partial<HerdrWorkspaceData> & { workspaceId: string },
): HerdrWorkspaceData {
  return {
    number: 1,
    label: `Workspace ${overrides.workspaceId}`,
    agentStatus: "idle",
    worktreeName: null,
    agentPanes: [],
    shellPanes: [],
    ...overrides,
  };
}

async function renderRail(
  workspaces: HerdrWorkspaceData[],
  selectedSessionId: string | null = null,
): Promise<void> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(herdrWorkspacesQueryOptions.queryKey, { workspaces });
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <HerdrWorkspaceRail selectedSessionId={selectedSessionId} />
      </QueryClientProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/herdr"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
}

describe("HerdrWorkspaceRail", () => {
  it("links Claude panes to their live terminal and leaves unlinked agents inert", async () => {
    await renderRail([
      workspace({
        workspaceId: "wA",
        number: 1,
        label: "kalshi",
        agentPanes: [
          pane({
            paneId: "wA:p1",
            agent: "claude",
            agentStatus: "blocked",
            sessionId: "session-test-100",
            title: "✓ kalshi",
          }),
          pane({ paneId: "wA:p2", agent: "codex", agentStatus: "working", title: "codex kalshi" }),
        ],
      }),
    ]);

    expect({
      links: screen.getAllByRole("link").map((link) => ({
        href: link.getAttribute("href"),
        label: link.getAttribute("aria-label"),
      })),
      unlinked: screen
        .getAllByTitle(/no indexed Claude transcript/)
        .map((row) => row.getAttribute("title")),
      statuses: screen.getAllByLabelText(/^Herdr agent status:/).map((el) => el.textContent),
    }).toStrictEqual({
      links: [
        {
          href: "/herdr/terminal/session-test-100",
          label: "Open live terminal for ✓ kalshi in workspace kalshi",
        },
      ],
      unlinked: ["codex kalshi has no indexed Claude transcript to open"],
      statuses: ["idle", "blocked", "working"],
    });
  });

  it("hides bare shell panes behind a per-workspace disclosure", async () => {
    await renderRail([
      workspace({
        workspaceId: "wA",
        label: "kalshi",
        agentPanes: [
          pane({ paneId: "wA:p1", agent: "claude", sessionId: "session-test-100", title: "agent" }),
        ],
        shellPanes: [
          pane({ paneId: "wA:p2", title: "shell one" }),
          pane({ paneId: "wA:p3", title: "shell two" }),
        ],
      }),
    ]);

    const disclosure = screen.getByRole("button", { name: "Show 2 shell panes in kalshi" });
    expect({
      label: disclosure.textContent,
      expanded: disclosure.getAttribute("aria-expanded"),
      shellBeforeExpanding: screen.queryByText("shell one"),
    }).toStrictEqual({ label: "2 shells", expanded: "false", shellBeforeExpanding: null });

    fireEvent.click(disclosure);

    expect({
      shells: screen.getAllByText(/^shell /).map((element) => element.textContent),
      collapseLabel: screen
        .getByRole("button", { name: "Hide 2 shell panes in kalshi" })
        .getAttribute("aria-expanded"),
    }).toStrictEqual({ shells: ["shell one", "shell two"], collapseLabel: "true" });
  });

  it("collapses a workspace so its panes leave the rail", async () => {
    await renderRail([
      workspace({
        workspaceId: "wA",
        number: 7,
        label: "kalshi",
        agentPanes: [
          pane({ paneId: "wA:p1", agent: "claude", sessionId: "session-test-100", title: "agent" }),
        ],
      }),
    ]);

    const header = screen.getByRole("button", { name: "Collapse workspace 7 kalshi" });
    expect(header.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(header);

    expect({
      paneAfterCollapse: screen.queryByText("agent"),
      expanded: screen
        .getByRole("button", { name: "Expand workspace 7 kalshi" })
        .getAttribute("aria-expanded"),
    }).toStrictEqual({ paneAfterCollapse: null, expanded: "false" });
  });

  it("marks the selected pane as the current rail page", async () => {
    await renderRail(
      [
        workspace({
          workspaceId: "wA",
          label: "kalshi",
          agentPanes: [
            pane({
              paneId: "wA:p1",
              agent: "claude",
              sessionId: "session-test-100",
              title: "selected",
            }),
            pane({
              paneId: "wA:p2",
              agent: "claude",
              sessionId: "session-test-200",
              title: "other",
            }),
          ],
        }),
      ],
      "session-test-100",
    );

    expect(
      screen.getAllByRole("link").map((link) => ({
        href: link.getAttribute("href"),
        current: link.getAttribute("aria-current"),
      })),
    ).toStrictEqual([
      { href: "/herdr/terminal/session-test-100", current: "page" },
      { href: "/herdr/terminal/session-test-200", current: null },
    ]);
  });

  it("explains an empty fleet instead of rendering a bare rail", async () => {
    await renderRail([]);

    expect({
      empty: screen.getByText("No Herdr workspaces").textContent,
      navigations: screen.getAllByRole("navigation").map((nav) => nav.getAttribute("aria-label")),
    }).toStrictEqual({ empty: "No Herdr workspaces", navigations: ["Herdr workspaces"] });
  });
});
