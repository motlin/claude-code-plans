// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { SessionPage } from "../src/components/session-page";
import { SettingsProvider } from "../src/components/settings-provider";
import { ToastProvider } from "../src/components/toast";
import { ClaudeEventsProvider } from "../src/hooks/use-claude-events";
import { herdrPanesQueryOptions } from "../src/lib/api/herdr";
import {
  sessionDetailQueryOptions,
  sessionOpenInQueryOptions,
  sessionSubagentsQueryOptions,
  transcriptQueryOptions,
  type SessionDetailData,
} from "../src/lib/api/sessions";
import type { Subagent } from "../src/lib/subagents";
import { __unreadStoreTesting } from "../src/lib/unread-store";
import { installLocalStorage } from "./fake-storage";

vi.mock(import("../src/lib/hmr-persist"), async (importOriginal) => ({
  ...(await importOriginal()),
  hmrPersist: <T,>(_key: string, initialize: () => T): T => initialize(),
}));

const SESSION_ID = "8f0c2c7e-1111-4222-8333-944445555666";
const TITLE = "Sync fork with upstream";
const SUMMARY = "Rebased the fork onto upstream and resolved three conflicts.";
const PROJECT_PATH = "/Users/alice/projects/avalonlogs";

const detail: SessionDetailData = {
  title: TITLE,
  projectName: "avalonlogs",
  projectId: "-Users-alice-projects-avalonlogs",
  homeRoot: "/Users/alice",
  imageRoots: [],
  archived: false,
  summary: SUMMARY,
  projectPath: PROJECT_PATH,
  gitBranch: "alice/sync-upstream",
  cwd: PROJECT_PATH,
  gitSha: null,
  gitClean: null,
  messageCount: 1,
  pendingTaskCount: 0,
  viewedState: {
    currentMessageIndex: 0,
    lastViewedMessageIndex: 0,
    reviewTargetMessageIndex: 0,
    newMessageCount: 0,
    viewedInCcp: true,
    viewedInHerdr: false,
    viewedAnywhere: true,
  },
};

function subagent(id: string): Subagent {
  return {
    id,
    sessionId: SESSION_ID,
    projectId: detail.projectId,
    parentAgentId: null,
    agentType: "Explore",
    attributionAgent: null,
    slug: null,
    description: `Fabricated subagent ${id}`,
    model: null,
    startedAt: null,
    finishedAt: null,
  };
}

class TestResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

class TestEventSource extends EventTarget {
  readonly close = vi.fn();
  onerror: ((event: Event) => void) | null = null;
}

class TestIntersectionObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function newQueryClient(): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity, refetchOnMount: false },
    },
  });
  queryClient.setQueryData(herdrPanesQueryOptions.queryKey, { panes: [], writesEnabled: false });
  queryClient.setQueryData(sessionOpenInQueryOptions(SESSION_ID).queryKey, {
    cwd: PROJECT_PATH,
    bridgeSessionId: null,
  });
  return queryClient;
}

async function renderInRouter(queryClient: QueryClient, content: ReactNode) {
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <SettingsProvider>
          <ClaudeEventsProvider>
            <ToastProvider>{content}</ToastProvider>
          </ClaudeEventsProvider>
        </SettingsProvider>
      </QueryClientProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [`/session/${SESSION_ID}`] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  await screen.findByTestId("session-titlebar");
  await flush();
}

async function renderSessionPage(data: SessionDetailData, subagents: Subagent[]) {
  const queryClient = newQueryClient();
  queryClient.setQueryData(sessionDetailQueryOptions(SESSION_ID).queryKey, data);
  queryClient.setQueryData(transcriptQueryOptions(SESSION_ID).queryKey, {
    records: [
      {
        type: "user",
        uuid: "u1",
        sessionId: SESSION_ID,
        timestamp: "2026-09-28T10:00:00.000Z",
        message: { role: "user", content: "Fabricated prompt: sync the fork" },
      },
    ],
    byteOffset: 0,
    startIndex: 0,
    precedingMessageCount: 0,
  });
  queryClient.setQueryData(sessionSubagentsQueryOptions(SESSION_ID).queryKey, subagents);
  await renderInRouter(queryClient, <SessionPage sessionId={SESSION_ID} />);
}

beforeEach(() => {
  installLocalStorage();
  Element.prototype.scrollIntoView = vi.fn<Element["scrollIntoView"]>();
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  vi.stubGlobal("EventSource", TestEventSource);
  vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise<Response>(() => {})),
  );
  __unreadStoreTesting.reset();
  __unreadStoreTesting.setPersist(() => Promise.resolve());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  __unreadStoreTesting.reset();
});

describe("AI summary placement", () => {
  it("renders the summary once, as the first transcript row and the title's tooltip", async () => {
    await renderSessionPage(detail, []);

    const rows = screen.getAllByText(SUMMARY);
    const row = rows[0];
    const transcript = row?.parentElement;
    const titleButton = screen.getByRole("button", { name: `${TITLE}, rename session` });
    const header = screen.getByTestId("session-titlebar").parentElement;

    expect({
      count: rows.length,
      rowIsFirstInTranscript: transcript?.firstElementChild === row,
      rowFollowedByMessages: row?.nextElementSibling?.textContent?.includes("sync the fork"),
      inHeader: header?.contains(row ?? null),
      tooltip: titleButton.getAttribute("title"),
      description: titleButton.getAttribute("aria-description"),
    }).toStrictEqual({
      count: 1,
      rowIsFirstInTranscript: true,
      rowFollowedByMessages: true,
      inHeader: false,
      tooltip: `Rename\n\n${SUMMARY}`,
      description: SUMMARY,
    });
  });

  it("offers Generate AI summary only in the chevron menu", async () => {
    await renderSessionPage({ ...detail, summary: null }, []);

    const headerButton = screen.queryByRole("button", { name: "Generate AI summary" });
    fireEvent.click(screen.getByRole("button", { name: `More options for ${TITLE}` }));
    await flush();

    expect({
      headerButton,
      menuItem: screen.getByRole("menuitem", { name: "Generate AI summary" }).textContent,
      summaryRow: screen.queryByTestId("session-summary-row"),
      tooltip: screen
        .getByRole("button", { name: `${TITLE}, rename session` })
        .getAttribute("title"),
    }).toStrictEqual({
      headerButton: null,
      menuItem: "Generate AI summary",
      summaryRow: null,
      tooltip: "Rename",
    });
  });
});

describe("subagents placement", () => {
  it("moves the subagent count out of the titlebar into the Background tasks pane", async () => {
    await renderSessionPage(detail, [subagent("a1"), subagent("a2")]);

    const pill = screen
      .getByTestId("session-titlebar")
      .querySelector('[data-origin-pill="subagents"]');
    fireEvent.click(screen.getByRole("button", { name: "View options" }));
    await flush();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Background tasks" }));
    await flush();
    const link = screen.getByRole("link", { name: "2 subagents" });

    expect({
      pill,
      href: link.getAttribute("href"),
      activeBox: screen.queryByRole("region", { name: "Active subagents" }),
      links: screen.getAllByText(/subagents?$/).length,
    }).toStrictEqual({
      pill: null,
      href: `/session/${SESSION_ID}/subagents`,
      activeBox: null,
      links: 1,
    });
  });
});
