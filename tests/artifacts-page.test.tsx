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
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { artifactsQueryOptions, ArtifactListResponse } from "../src/lib/api/artifacts";
import {
  ARTIFACTS_LAYOUT_STORAGE_KEY,
  artifactDateGroupLabel,
  filterArtifacts,
  groupArtifactsByDate,
} from "../src/lib/artifact-gallery";
import { getArtifacts } from "../src/lib/db/artifact-queries";
import { openTestDb, type AppDb } from "../src/lib/db/connection";
import * as schema from "../src/lib/db/schema";
import { Route as ArtifactsRoute } from "../src/routes/artifacts";
import { artifactPreviewPath } from "../src/lib/artifact-source-paths";
import { installLocalStorage } from "./fake-storage";

const NOW = new Date(2026, 8, 29, 12, 0, 0);

function localMs(year: number, monthIndex: number, day: number, hour = 10): number {
  return new Date(year, monthIndex, day, hour, 0, 0).getTime();
}

describe("artifactDateGroupLabel", () => {
  it("uses upstream's buckets: days within a week, then months this year, then month and year", () => {
    expect([
      artifactDateGroupLabel(localMs(2026, 8, 29), NOW),
      artifactDateGroupLabel(localMs(2026, 8, 26), NOW),
      artifactDateGroupLabel(localMs(2026, 8, 23), NOW),
      artifactDateGroupLabel(localMs(2026, 8, 22), NOW),
      artifactDateGroupLabel(localMs(2026, 5, 10), NOW),
      artifactDateGroupLabel(localMs(2026, 0, 1, 0), NOW),
      artifactDateGroupLabel(localMs(2025, 10, 3), NOW),
    ]).toStrictEqual([
      "Sep 29",
      "Sep 26",
      "Sep 23",
      "September",
      "June",
      "January",
      "November 2025",
    ]);
  });

  it("groups consecutive items that share a bucket, keyed by the last publish", () => {
    const items = [
      { id: "a", lastPublishedAt: localMs(2026, 8, 26, 15), firstSeenAt: localMs(2026, 0, 1) },
      { id: "b", lastPublishedAt: localMs(2026, 8, 26, 9), firstSeenAt: localMs(2026, 0, 1) },
      { id: "c", lastPublishedAt: null, firstSeenAt: localMs(2026, 8, 10) },
      { id: "d", lastPublishedAt: localMs(2026, 8, 2), firstSeenAt: localMs(2026, 8, 1) },
      { id: "e", lastPublishedAt: localMs(2025, 10, 3), firstSeenAt: localMs(2025, 10, 3) },
    ];

    expect(
      groupArtifactsByDate(items, NOW).map((group) => ({
        label: group.label,
        ids: group.items.map((item) => item.id),
      })),
    ).toStrictEqual([
      { label: "Sep 26", ids: ["a", "b"] },
      { label: "September", ids: ["c", "d"] },
      { label: "November 2025", ids: ["e"] },
    ]);
  });
});

const LADDER_URL = "https://claude.ai/code/artifact/546d3910-4e9a-4730-9e91-62742a47c7c6";
const CHART_URL = "https://claude.ai/code/artifact/17b8a2c1-4c41-46bf-b064-a272240be709";
const DOCS_URL = "https://claude.ai/artifact/7Hq2vXbN4pLmKcR9sTwYzA";
const LADDER_SOURCE = "/Users/alice/projects/ladder/.llm/mockups/ladder.html";
const LADDER_MTIME = 1_790_000_000_000;

function ladderMtime(path: string): number | null {
  return path === LADDER_SOURCE ? LADDER_MTIME : null;
}

function seedArtifacts(db: AppDb): void {
  const base = {
    favicon: null,
    description: null,
    version: "1",
    projectId: "-Users-alice-projects-ladder",
  };
  db.index
    .insert(schema.artifacts)
    .values([
      {
        ...base,
        url: LADDER_URL,
        id: "546d3910-4e9a-4730-9e91-62742a47c7c6",
        urlKind: "uuid",
        title: "Asap Ladder Queue",
        sourcePath: LADDER_SOURCE,
        audience: "owner",
        firstSeenAt: localMs(2026, 8, 20),
        lastPublishedAt: localMs(2026, 8, 26, 15),
        publishCount: 3,
        lastSessionId: "session-ladder",
      },
      {
        ...base,
        url: CHART_URL,
        id: "17b8a2c1-4c41-46bf-b064-a272240be709",
        urlKind: "uuid",
        title: null,
        sourcePath: "/private/tmp/scratchpad/household-cash.html",
        audience: null,
        firstSeenAt: localMs(2026, 5, 1),
        lastPublishedAt: localMs(2026, 5, 10),
        publishCount: 1,
        lastSessionId: "session-chart",
      },
      {
        ...base,
        url: DOCS_URL,
        id: "7Hq2vXbN4pLmKcR9sTwYzA",
        urlKind: "slug",
        title: "Quarterly plan",
        sourcePath: null,
        audience: "owner",
        firstSeenAt: localMs(2025, 10, 3),
        lastPublishedAt: localMs(2025, 10, 3),
        publishCount: 1,
        lastSessionId: "session-docs",
      },
    ])
    .run();
}

describe("getArtifacts", () => {
  it("lists artifacts newest first with a title fallback and whether the source still exists", () => {
    const db = openTestDb();
    seedArtifacts(db);

    const artifacts = getArtifacts(db.index, {}, ladderMtime);

    expect(
      artifacts.map(({ id, title, kind, sourceExists, sourceModifiedAt, sessionId }) => ({
        id,
        title,
        kind,
        sourceExists,
        sourceModifiedAt,
        sessionId,
      })),
    ).toStrictEqual([
      {
        id: "546d3910-4e9a-4730-9e91-62742a47c7c6",
        title: "Asap Ladder Queue",
        kind: "html",
        sourceExists: true,
        sourceModifiedAt: LADDER_MTIME,
        sessionId: "session-ladder",
      },
      {
        id: "17b8a2c1-4c41-46bf-b064-a272240be709",
        title: "household-cash.html",
        kind: "html",
        sourceExists: false,
        sourceModifiedAt: null,
        sessionId: "session-chart",
      },
      {
        id: "7Hq2vXbN4pLmKcR9sTwYzA",
        title: "Quarterly plan",
        kind: "docs",
        sourceExists: false,
        sourceModifiedAt: null,
        sessionId: "session-docs",
      },
    ]);
  });

  it("filters by title, ignoring case", () => {
    const db = openTestDb();
    seedArtifacts(db);

    expect(getArtifacts(db.index, { q: "LADDER" }, () => null).map((a) => a.id)).toStrictEqual([
      "546d3910-4e9a-4730-9e91-62742a47c7c6",
    ]);
  });

  it("filters by type on the client", () => {
    const db = openTestDb();
    seedArtifacts(db);
    const artifacts = getArtifacts(db.index, {}, () => null);

    expect({
      docs: filterArtifacts(artifacts, { search: "", type: "docs" }).map((a) => a.id),
      html: filterArtifacts(artifacts, { search: "cash", type: "html" }).map((a) => a.id),
    }).toStrictEqual({
      docs: ["7Hq2vXbN4pLmKcR9sTwYzA"],
      html: ["17b8a2c1-4c41-46bf-b064-a272240be709"],
    });
  });
});

let storage: ReturnType<typeof installLocalStorage>;

beforeEach(() => {
  storage = installLocalStorage();
});

afterEach(() => {
  cleanup();
});

async function renderArtifactsPage(initialEntry: string, seed: boolean) {
  const db = openTestDb();
  if (seed) seedArtifacts(db);
  const data = ArtifactListResponse.parse(
    JSON.parse(JSON.stringify(getArtifacts(db.index, {}, ladderMtime))),
  );

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(artifactsQueryOptions.queryKey, data);

  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <Outlet />
      </QueryClientProvider>
    ),
  });
  const { validateSearch, component } = ArtifactsRoute.options;
  const artifactsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/artifacts",
    ...(validateSearch ? { validateSearch } : {}),
    ...(component ? { component } : {}),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([artifactsRoute]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  await screen.findByRole("heading", { level: 1, name: "Artifacts" });
  return router;
}

function rowSummary(row: HTMLElement) {
  const primary = row.querySelector("a[data-primary]");
  return {
    title: primary?.getAttribute("aria-label"),
    href: primary?.getAttribute("href"),
    target: primary?.getAttribute("target"),
    rel: primary?.getAttribute("rel"),
    chips: within(row)
      .queryAllByRole("link")
      .filter((link) => !link.hasAttribute("data-primary"))
      .map((link) => ({ name: link.textContent, href: link.getAttribute("href") })),
    private: within(row).queryByRole("img", { name: "Private" }) !== null,
    meta: row.querySelector("[data-artifact-meta]")?.textContent,
  };
}

describe("artifacts route", () => {
  it("lists artifacts by date group linking out to claude.ai", async () => {
    await renderArtifactsPage("/artifacts", true);

    const groups = screen.getAllByRole("list").map((list) => ({
      heading: list.getAttribute("aria-labelledby")
        ? document.getElementById(list.getAttribute("aria-labelledby") ?? "")?.textContent
        : null,
      rows: within(list).getAllByRole("listitem").map(rowSummary),
    }));

    expect(groups).toStrictEqual([
      {
        heading: artifactDateGroupLabel(localMs(2026, 8, 26, 15), new Date()),
        rows: [
          {
            title: "Asap Ladder Queue",
            href: LADDER_URL,
            target: "_blank",
            rel: "noopener noreferrer",
            chips: [
              { name: "Session", href: "/session/session-ladder" },
              {
                name: "Preview",
                href: artifactPreviewPath("546d3910-4e9a-4730-9e91-62742a47c7c6"),
              },
            ],
            private: true,
            meta: expect.stringMatching(/^Edited /),
          },
        ],
      },
      {
        heading: artifactDateGroupLabel(localMs(2026, 5, 10), new Date()),
        rows: [
          {
            title: "household-cash.html",
            href: CHART_URL,
            target: "_blank",
            rel: "noopener noreferrer",
            chips: [{ name: "Session", href: "/session/session-chart" }],
            private: false,
            meta: expect.stringMatching(/^Edited /),
          },
        ],
      },
      {
        heading: artifactDateGroupLabel(localMs(2025, 10, 3), new Date()),
        rows: [
          {
            title: "Quarterly plan",
            href: DOCS_URL,
            target: "_blank",
            rel: "noopener noreferrer",
            chips: [{ name: "Session", href: "/session/session-docs" }],
            private: true,
            meta: expect.stringMatching(/^Edited /),
          },
        ],
      },
    ]);
  });

  it("shows the upstream empty state when nothing has been published", async () => {
    await renderArtifactsPage("/artifacts", false);

    expect({
      heading: screen.getByRole("heading", { level: 3 }).textContent,
      body: screen.getByText("Artifacts that Claude publishes in your sessions appear here.")
        .tagName,
    }).toStrictEqual({ heading: "No artifacts yet", body: "P" });
  });

  it("opens search from ?search= and announces the match count", async () => {
    await renderArtifactsPage("/artifacts?search=ladder", true);

    expect({
      input: (screen.getByRole("searchbox", { name: "Search your artifacts" }) as HTMLInputElement)
        .value,
      placeholder: screen.getByRole("searchbox").getAttribute("placeholder"),
      status: screen.getByRole("status").textContent,
      rows: screen.getAllByRole("listitem").map((row) => rowSummary(row).title),
    }).toStrictEqual({
      input: "ladder",
      placeholder: "Search artifacts...",
      status: "1 artifact matching “ladder”",
      rows: ["Asap Ladder Queue"],
    });
  });

  it("writes the search into the URL and shows the no-match message", async () => {
    const router = await renderArtifactsPage("/artifacts", true);

    fireEvent.click(screen.getByRole("button", { name: "Search your artifacts" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search your artifacts" }), {
      target: { value: "zzqx" },
    });

    await waitFor(() => {
      expect({ ...router.state.location.search }).toStrictEqual({ search: "zzqx" });
    });
    expect(screen.getAllByRole("status").map((status) => status.textContent)).toStrictEqual([
      "0 artifacts matching “zzqx”",
      "No artifacts matching “zzqx”",
    ]);
  });

  it("persists the grid/list toggle in localStorage", async () => {
    await renderArtifactsPage("/artifacts", true);

    fireEvent.click(screen.getByRole("button", { name: "Grid view" }));

    expect({
      stored: storage.getItem(ARTIFACTS_LAYOUT_STORAGE_KEY),
      toggle: screen.getByRole("button", { name: "List view" }).tagName,
      headings: screen.queryAllByRole("heading", { level: 2 }).length,
      cards: document.querySelectorAll("[data-gallery-card]").length,
    }).toStrictEqual({ stored: "grid", toggle: "BUTTON", headings: 0, cards: 3 });

    cleanup();
    await renderArtifactsPage("/artifacts", true);

    expect(screen.getByRole("button", { name: "List view" }).tagName).toBe("BUTTON");
  });
});
