// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { registerPane } from "../src/components/panes/pane-registry";
import { ArtifactsPaneToggle, SessionArtifactsList } from "../src/components/panes/artifacts-pane";
import { TileHost } from "../src/components/panes/tile-host";
import { SettingsProvider } from "../src/components/settings-provider";
import { SessionArtifactListResponse, type SessionArtifact } from "../src/lib/api/artifacts";
import { artifactPreviewPath } from "../src/lib/artifact-source-paths";
import { getSessionArtifacts } from "../src/lib/db/artifact-queries";
import { openTestDb, type AppDb } from "../src/lib/db/connection";
import * as schema from "../src/lib/db/schema";
import { installLocalStorage } from "./fake-storage";

const LADDER_URL = "https://claude.ai/code/artifact/546d3910-4e9a-4730-9e91-62742a47c7c6";
const CHART_URL = "https://claude.ai/code/artifact/17b8a2c1-4c41-46bf-b064-a272240be709";
const DOCS_URL = "https://claude.ai/artifact/7Hq2vXbN4pLmKcR9sTwYzA";
const OTHER_URL = "https://claude.ai/code/artifact/0f9e8d7c-6b5a-4c3d-8e2f-1a2b3c4d5e6f";
const LADDER_SOURCE = "/Users/alice/projects/ladder/.llm/mockups/ladder.html";
const PROJECT = "-Users-alice-projects-ladder";

function event(
  overrides: Partial<typeof schema.artifactEvents.$inferInsert> &
    Pick<typeof schema.artifactEvents.$inferInsert, "toolUseId" | "ts" | "action" | "url">,
): typeof schema.artifactEvents.$inferInsert {
  return {
    sessionId: "session-ladder",
    projectId: PROJECT,
    filePath: "/Users/alice/.claude/projects/ladder/session-ladder.jsonl",
    isSubagent: 0,
    title: null,
    favicon: null,
    description: null,
    sourcePath: null,
    version: null,
    audience: null,
    ...overrides,
  };
}

function seed(db: AppDb): void {
  db.index
    .insert(schema.artifacts)
    .values([
      {
        url: LADDER_URL,
        id: "546d3910-4e9a-4730-9e91-62742a47c7c6",
        urlKind: "uuid",
        title: "Asap Ladder Queue (latest anywhere)",
        favicon: null,
        description: null,
        sourcePath: LADDER_SOURCE,
        version: "3",
        audience: "owner",
        firstSeenAt: 1_000,
        lastPublishedAt: 9_000,
        publishCount: 3,
        lastSessionId: "session-other",
        projectId: PROJECT,
      },
      {
        url: CHART_URL,
        id: "17b8a2c1-4c41-46bf-b064-a272240be709",
        urlKind: "uuid",
        title: null,
        favicon: null,
        description: null,
        sourcePath: "/private/tmp/scratchpad/household-cash.html",
        version: "1",
        audience: null,
        firstSeenAt: 2_000,
        lastPublishedAt: 2_000,
        publishCount: 1,
        lastSessionId: "session-ladder",
        projectId: PROJECT,
      },
      {
        url: DOCS_URL,
        id: "7Hq2vXbN4pLmKcR9sTwYzA",
        urlKind: "slug",
        title: "Quarterly plan",
        favicon: null,
        description: null,
        sourcePath: null,
        version: "1",
        audience: "owner",
        firstSeenAt: 500,
        lastPublishedAt: 500,
        publishCount: 1,
        lastSessionId: "session-docs",
        projectId: PROJECT,
      },
    ])
    .run();
  db.index
    .insert(schema.artifactEvents)
    .values([
      event({
        toolUseId: "t1",
        ts: 1_000,
        action: "publish",
        url: LADDER_URL,
        title: "Asap Ladder Rebalance",
        sourcePath: LADDER_SOURCE,
      }),
      event({
        toolUseId: "t2",
        ts: 2_000,
        action: "publish",
        url: CHART_URL,
        sourcePath: "/private/tmp/scratchpad/household-cash.html",
      }),
      event({
        toolUseId: "t3",
        ts: 3_000,
        action: "publish",
        url: LADDER_URL,
        title: "Asap Ladder Queue",
        sourcePath: LADDER_SOURCE,
      }),
      event({ toolUseId: "t4", ts: 4_000, action: "open", url: DOCS_URL, isSubagent: 1 }),
      event({ toolUseId: "t5", ts: 5_000, action: "read", url: CHART_URL }),
      event({ toolUseId: "t6", ts: 6_000, action: "pin", url: CHART_URL }),
      event({
        toolUseId: "t7",
        ts: 7_000,
        action: "publish",
        url: OTHER_URL,
        sessionId: "session-other",
      }),
    ])
    .run();
}

describe("getSessionArtifacts", () => {
  it("lists the session's published and opened artifacts, most recent first, one row each", () => {
    const db = openTestDb();
    seed(db);

    expect(getSessionArtifacts(db.index, "session-ladder")).toStrictEqual([
      {
        url: DOCS_URL,
        id: "7Hq2vXbN4pLmKcR9sTwYzA",
        kind: "docs",
        title: "Quarterly plan",
        previewable: false,
        lastEventAt: 4_000,
      },
      {
        url: LADDER_URL,
        id: "546d3910-4e9a-4730-9e91-62742a47c7c6",
        kind: "html",
        title: "Asap Ladder Queue",
        previewable: true,
        lastEventAt: 3_000,
      },
      {
        url: CHART_URL,
        id: "17b8a2c1-4c41-46bf-b064-a272240be709",
        kind: "html",
        title: "household-cash.html",
        previewable: true,
        lastEventAt: 2_000,
      },
    ]);
  });

  it("is empty for a session without artifacts", () => {
    const db = openTestDb();
    seed(db);

    expect(getSessionArtifacts(db.index, "session-none")).toStrictEqual([]);
  });

  it("matches the API response schema", () => {
    const db = openTestDb();
    seed(db);
    const artifacts = getSessionArtifacts(db.index, "session-ladder");

    expect(SessionArtifactListResponse.parse(artifacts)).toStrictEqual(artifacts);
  });
});

const ARTIFACTS: SessionArtifact[] = [
  {
    url: DOCS_URL,
    id: "7Hq2vXbN4pLmKcR9sTwYzA",
    kind: "docs",
    title: "Quarterly plan",
    previewable: false,
    lastEventAt: 4_000,
  },
  {
    url: LADDER_URL,
    id: "546d3910-4e9a-4730-9e91-62742a47c7c6",
    kind: "html",
    title: "Asap Ladder Queue",
    previewable: true,
    lastEventAt: 3_000,
  },
];

describe("SessionArtifactsList", () => {
  afterEach(cleanup);

  it("shows upstream's empty copy when the session has no artifacts", () => {
    const { container } = render(<SessionArtifactsList artifacts={[]} />);

    expect(container.textContent).toBe("Artifacts published in this session appear here.");
  });

  it("renders one upstream card per artifact, in order, linking out to claude.ai", () => {
    render(<SessionArtifactsList artifacts={ARTIFACTS} />);

    const cards = screen.getAllByRole("button", { name: /^Open artifact / });
    expect(
      cards.map((card) => ({
        label: card.getAttribute("aria-label"),
        href: card.getAttribute("href"),
        target: card.getAttribute("target"),
        rel: card.getAttribute("rel"),
      })),
    ).toStrictEqual([
      {
        label: "Open artifact Quarterly plan",
        href: DOCS_URL,
        target: "_blank",
        rel: "noopener noreferrer",
      },
      {
        label: "Open artifact Asap Ladder Queue",
        href: LADDER_URL,
        target: "_blank",
        rel: "noopener noreferrer",
      },
    ]);
    expect(
      screen.getAllByRole("link", { name: "Preview source" }).map((a) => a.getAttribute("href")),
    ).toStrictEqual([artifactPreviewPath("546d3910-4e9a-4730-9e91-62742a47c7c6")]);
  });
});

class FakeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

describe("ArtifactsPaneToggle", () => {
  let unregister: () => void = () => {};

  beforeEach(() => {
    installLocalStorage();
    vi.stubGlobal("ResizeObserver", FakeObserver);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 0, y: 0, width: 1200, height: 800 }),
    );
    unregister = registerPane("artifacts", {
      title: "Artifacts",
      render: () => <SessionArtifactsList artifacts={ARTIFACTS} />,
    });
  });

  afterEach(() => {
    unregister();
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function renderToggle(count: number) {
    return render(
      <SettingsProvider>
        <TileHost sessionId="session-artifacts">
          <ArtifactsPaneToggle count={count} />
        </TileHost>
      </SettingsProvider>,
    );
  }

  it("shows the artifact count and opens the Artifacts pane", () => {
    renderToggle(2);
    const toggle = screen.getByRole("button", { name: "Artifacts 2" });

    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(within(toggle).getByText("2").getAttribute("data-count")).toBe("");
    expect(screen.queryByRole("region", { name: "Artifacts" })).toBeNull();

    act(() => {
      fireEvent.click(toggle);
    });

    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    const pane = screen.getByRole("region", { name: "Artifacts" });
    expect(
      within(pane)
        .getAllByRole("button", { name: /^Open artifact / })
        .map((card) => card.getAttribute("aria-label")),
    ).toStrictEqual(["Open artifact Quarterly plan", "Open artifact Asap Ladder Queue"]);
  });

  it("is hidden while the session has no artifacts and the pane is closed", () => {
    renderToggle(0);

    expect(screen.queryByRole("button", { name: /^Artifacts/ })).toBeNull();
  });
});
