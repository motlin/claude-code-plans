// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { ClaudeEventsProvider } from "../src/hooks/use-claude-events";
import { herdrPanesQueryOptions } from "../src/lib/api/herdr";
import {
  sessionDetailQueryOptions,
  sessionSubagentsQueryOptions,
  transcriptQueryOptions,
  type SessionDetailData,
} from "../src/lib/api/sessions";
import { SessionPage } from "../src/components/session-page";

// session-chat pulls in HMR-persisted module state that jsdom cannot evaluate.
vi.mock("../src/components/session-chat", () => ({
  SessionChat: () => null,
}));

class TestEventSource extends EventTarget {
  readonly close = vi.fn();
  onerror: ((event: Event) => void) | null = null;
}

class FakeStorage implements Storage {
  readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

class TestIntersectionObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

const SESSION_ID = "session-test-100";

const detail: SessionDetailData = {
  title: "Alice's containment test",
  projectName: "example",
  projectId: "project-test-100",
  homeRoot: "/home/alice",
  imageRoots: [],
  starred: false,
  summary: null,
  projectPath: null,
  gitBranch: null,
  cwd: null,
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

function seededQueryClient() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(sessionDetailQueryOptions(SESSION_ID).queryKey, detail);
  queryClient.setQueryData(transcriptQueryOptions(SESSION_ID).queryKey, {
    records: [
      {
        type: "assistant",
        uuid: "uuid-test-100",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-use-read-example",
              name: "Read",
              input: { file_path: "/home/alice/example/read.ts" },
            },
          ],
        },
      },
    ],
    byteOffset: 0,
    startIndex: 0,
    precedingMessageCount: 0,
  });
  queryClient.setQueryData(sessionSubagentsQueryOptions(SESSION_ID).queryKey, []);
  queryClient.setQueryData(herdrPanesQueryOptions.queryKey, {
    panes: [],
    writesEnabled: false,
  });
  return queryClient;
}

async function renderSessionInScroller() {
  const queryClient = seededQueryClient();
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <ClaudeEventsProvider>
          <main data-testid="app-scroller" style={{ overflowY: "auto" }}>
            <SessionPage sessionId={SESSION_ID} />
          </main>
        </ClaudeEventsProvider>
      </QueryClientProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({
      initialEntries: [`/session/${SESSION_ID}`],
    }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return screen.findByTestId("app-scroller");
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("fixed-position session UI and the contained transcript scroller", () => {
  it("renders the drawer and scroll buttons outside the [contain:strict] scroller", async () => {
    vi.stubGlobal("EventSource", TestEventSource);
    vi.stubGlobal("localStorage", new FakeStorage());
    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );

    const scroller = await renderSessionInScroller();
    const filesToggle = await screen.findByRole("button", { name: /Files/ });
    await act(async () => {
      fireEvent.click(filesToggle);
    });

    const drawer = screen.getByRole("complementary", { name: /files/i });
    const scrollToTop = screen.getByTitle("Scroll to top");
    const containedElements = [...document.querySelectorAll("*")].filter((element) =>
      element.classList.contains("[contain:strict]"),
    );

    expect({
      containedElements,
      drawerInsideScroller: scroller.contains(drawer),
      scrollButtonsInsideScroller: scroller.contains(scrollToTop),
      drawerInsideContained: containedElements.some((element) => element.contains(drawer)),
      scrollButtonsInsideContained: containedElements.some((element) =>
        element.contains(scrollToTop),
      ),
    }).toStrictEqual({
      containedElements: [scroller],
      drawerInsideScroller: false,
      scrollButtonsInsideScroller: false,
      drawerInsideContained: false,
      scrollButtonsInsideContained: false,
    });
  });
});
