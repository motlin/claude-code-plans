// @vitest-environment jsdom

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { DEFAULTS } from "../src/components/settings-provider";
import { activeSessionsQueryOptions } from "../src/lib/api/sessions";
import type { ActivityState } from "../src/lib/session-state";
import { clearAll, markUnseen } from "../src/lib/unread-store";
import { Route as ActiveRoute } from "../src/routes/active";
import { installLocalStorage } from "./fake-storage";

const pushedActiveSessions = new Map<
  string,
  { cwd: string; startedAt: number; lastActivity: number }
>();

vi.mock("../src/hooks/use-claude-events", () => ({
  useClaudeEvents: () => ({ activeSessions: pushedActiveSessions }),
}));

afterEach(() => {
  cleanup();
  pushedActiveSessions.clear();
});

const ACTIVE_ROW_COLUMNS =
  "grid grid-cols-[minmax(0,1fr)_5rem_8.5rem_7rem_9rem] items-center rounded-md border border-border";
const ACTIVE_TRANSCRIPT_COLUMNS =
  "grid grid-cols-[minmax(0,1fr)_minmax(0,8rem)] items-center gap-1.5 rounded-md p-3 no-underline transition-colors hover:bg-surface-0/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-100";
const ACTIVE_ACTION_CELL = "justify-self-end";

const MINUTE_MS = 60_000;

function activeSession({
  blockedSince = null,
  minutesSinceModified = 5,
  number,
  projectName,
  state = "idle",
  title,
}: {
  blockedSince?: string | null;
  minutesSinceModified?: number;
  number: number;
  projectName?: string;
  state?: ActivityState;
  title?: string;
}) {
  const now = Date.now();
  return {
    sessionId: `session-test-${number}`,
    projectDir: `-tmp-test-project-${number}`,
    projectName: projectName ?? `project-${number}`,
    title: title ?? `Session ${number}`,
    createdAt: now - 30 * MINUTE_MS,
    lastModified: now - minutesSinceModified * MINUTE_MS,
    state,
    blockedSince,
  };
}

async function renderActivePage(sessions: ReturnType<typeof activeSession>[]) {
  const ActivePage = ActiveRoute.options.component;
  if (!ActivePage) throw new Error("Expected the Active route component");

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(
    activeSessionsQueryOptions(DEFAULTS.activeTimeoutSec * 1000).queryKey,
    sessions,
  );
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>{createElement(ActivePage)}</QueryClientProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/active"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
}

function rowFor(title: string): Element {
  const row = screen.getByRole("link", {
    name: `Open session transcript for ${title}`,
  }).parentElement;
  if (!row) throw new Error(`Expected an active-session row for ${title}`);
  return row;
}

describe("ActivePage rows", () => {
  beforeEach(() => {
    installLocalStorage();
    clearAll();
  });

  it("gives every row the same fixed columns so only the title is variable-width", async () => {
    await renderActivePage([
      activeSession({
        minutesSinceModified: 0,
        number: 100,
        projectName: "claude-code-plans",
        state: "working",
        title: "Render active like herdr",
      }),
      activeSession({
        blockedSince: new Date(Date.now() - 40 * MINUTE_MS).toISOString(),
        minutesSinceModified: 3,
        number: 200,
        projectName: "kalshi",
        state: "waiting",
        title: "Approve the plan",
      }),
    ]);

    expect(
      ["Render active like herdr", "Approve the plan"].map((title) => {
        const row = rowFor(title);
        const [transcript, status, review, modified, action] = Array.from(row.children);
        const [titleCell, projectCell] = Array.from(transcript?.children ?? []);
        return {
          rowColumns: row.className,
          cells: row.children.length,
          transcriptColumns: transcript?.className,
          title: titleCell?.textContent,
          project: projectCell?.textContent,
          status: status?.getAttribute("aria-label"),
          statusLabel: status?.lastElementChild?.textContent,
          review: review?.textContent,
          modified: modified?.textContent,
          actionCell: action?.className,
        };
      }),
    ).toStrictEqual([
      {
        rowColumns: ACTIVE_ROW_COLUMNS,
        cells: 5,
        transcriptColumns: ACTIVE_TRANSCRIPT_COLUMNS,
        title: "Render active like herdr",
        project: "claude-code-plans",
        status: "Session status: working",
        statusLabel: "working",
        review: "",
        modified: "modified 0s ago",
        actionCell: ACTIVE_ACTION_CELL,
      },
      {
        rowColumns: ACTIVE_ROW_COLUMNS,
        cells: 5,
        transcriptColumns: ACTIVE_TRANSCRIPT_COLUMNS,
        title: "Approve the plan",
        project: "kalshi",
        status: "Session status: waiting",
        statusLabel: "waiting",
        review: "",
        modified: "modified 3m ago",
        actionCell: ACTIVE_ACTION_CELL,
      },
    ]);
  });

  it("keeps heating the status dot the longer a waiting session stays blocked", async () => {
    await renderActivePage([
      activeSession({
        blockedSince: new Date(Date.now() - 40 * MINUTE_MS).toISOString(),
        number: 100,
        state: "waiting",
        title: "Blocked for ages",
      }),
      activeSession({
        blockedSince: new Date(Date.now() - 15 * MINUTE_MS).toISOString(),
        number: 200,
        state: "waiting",
        title: "Blocked a while",
      }),
      activeSession({ number: 300, state: "working", title: "Not blocked" }),
    ]);

    expect(
      ["Blocked for ages", "Blocked a while", "Not blocked"].map(
        (title) =>
          Array.from(rowFor(title).children)[1]?.firstElementChild?.lastElementChild?.className,
      ),
    ).toStrictEqual([
      "relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500",
      "relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500",
      "relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500",
    ]);
  });

  it("marks an unseen session reviewed from the row without leaving reviewed chrome behind", async () => {
    markUnseen("session-test-100");
    await renderActivePage([
      activeSession({ number: 100, state: "idle", title: "Finished while I was away" }),
      activeSession({ number: 200, state: "idle", title: "Already seen" }),
    ]);

    const unseenRow = rowFor("Finished while I was away");
    const seenRow = rowFor("Already seen");
    expect({
      unseenMarker: Array.from(unseenRow.children)[2]?.textContent,
      unseenAction: unseenRow.querySelector("button")?.textContent,
      seenMarker: Array.from(seenRow.children)[2]?.textContent,
      seenAction: seenRow.querySelector("button"),
    }).toStrictEqual({
      unseenMarker: "Needs review",
      unseenAction: "Mark reviewed",
      seenMarker: "",
      seenAction: null,
    });

    fireEvent.click(screen.getByRole("button", { name: "Mark reviewed" }));

    await waitFor(() =>
      expect({
        marker: screen.queryByText(/Needs review/),
        action: screen.queryByRole("button", { name: "Mark reviewed" }),
        storedUnseenWork: localStorage.getItem("ccp-unseen-work"),
      }).toStrictEqual({ marker: null, action: null, storedUnseenWork: null }),
    );
  });

  it("renders a session the SSE reducer knows about before the loader refetches it", async () => {
    pushedActiveSessions.set("session-test-900", {
      cwd: "/tmp/test/just-started",
      startedAt: Date.now() - MINUTE_MS,
      lastActivity: Date.now() - MINUTE_MS,
    });
    await renderActivePage([activeSession({ number: 100, title: "Already loaded" })]);

    const pushedRow = rowFor("session-test-900");
    const [transcript, status] = Array.from(pushedRow.children);
    const [titleCell, projectCell] = Array.from(transcript?.children ?? []);
    expect({
      title: titleCell?.textContent,
      project: projectCell?.textContent,
      status: status?.getAttribute("aria-label"),
      href: transcript?.getAttribute("href"),
      rowCount: screen.getAllByRole("link", { name: /^Open session transcript for/ }).length,
    }).toStrictEqual({
      title: "session-test-900",
      project: "just-started",
      status: "Session status: unknown",
      href: "/session/session-test-900",
      rowCount: 2,
    });
  });
});

/**
 * /active is fed entirely by `/api/sessions/active`, so it has to keep rendering
 * when herdr is not installed or not running. Sharing row chrome with /herdr is
 * only safe while the shared pieces stay herdr-free.
 */
describe("ActivePage independence from herdr", () => {
  const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src");

  function resolveRelativeImport(fromFile: string, specifier: string): string | null {
    const base = resolve(dirname(fromFile), specifier);
    const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")];
    return candidates.find((path) => existsSync(path) && statSync(path).isFile()) ?? null;
  }

  it("reaches no herdr module from the /active route", () => {
    const entry = join(srcRoot, "routes", "active.tsx");
    const visited = new Set<string>();
    const queue = [entry];

    while (queue.length > 0) {
      const file = queue.pop();
      if (file === undefined || visited.has(file)) continue;
      visited.add(file);
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/from\s+["'](\.[^"']*)["']/g)) {
        const specifier = match[1];
        if (specifier === undefined) continue;
        const resolved = resolveRelativeImport(file, specifier);
        if (resolved !== null) queue.push(resolved);
      }
    }

    expect([...visited].filter((file) => file.includes("herdr"))).toStrictEqual([]);
  });
});
