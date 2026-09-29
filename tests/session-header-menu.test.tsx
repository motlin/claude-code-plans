// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { ClaudeEventsProvider } from "../src/hooks/use-claude-events";
import { SESSION_MENU_CAPABILITIES } from "../src/components/session-actions-menu";
import { SessionPage } from "../src/components/session-page";
import { SettingsProvider } from "../src/components/settings-provider";
import {
  SessionTitlebar,
  type SessionHeaderLocalActions,
} from "../src/components/session-titlebar";
import { ToastProvider } from "../src/components/toast";
import { herdrPanesQueryOptions, type HerdrPaneIndexData } from "../src/lib/api/herdr";
import {
  sessionDetailQueryOptions,
  sessionOpenInQueryOptions,
  sessionSubagentsQueryOptions,
  transcriptQueryOptions,
  type SessionDetailData,
} from "../src/lib/api/sessions";
import { readPinState } from "../src/lib/pin-store";
import { getSessionMenuItems, type SessionMenuEntry } from "../src/lib/session-menu-items";
import { __unreadStoreTesting } from "../src/lib/unread-store";
import { installLocalStorage } from "./fake-storage";

// session-chat pulls in HMR-persisted module state that jsdom cannot evaluate.
vi.mock("../src/components/session-chat", () => ({
  SessionChat: () => null,
}));

const SESSION_ID = "8f0c2c7e-1111-4222-8333-944445555666";
const TITLE = "Sync fork with upstream";
const PROJECT_PATH = "/Users/alice/projects/avalonlogs";
const RESUME_COMMAND = `cd '${PROJECT_PATH}' && claude -r ${SESSION_ID}`;
const FORK_COMMAND = `${RESUME_COMMAND} --fork-session`;

const detail: SessionDetailData = {
  title: TITLE,
  projectName: "avalonlogs",
  projectId: "-Users-alice-projects-avalonlogs",
  homeRoot: "/Users/alice",
  imageRoots: [],
  archived: false,
  summary: null,
  projectPath: PROJECT_PATH,
  gitBranch: "alice/sync-upstream",
  cwd: PROJECT_PATH,
  gitSha: null,
  gitClean: null,
  messageCount: 4,
  pendingTaskCount: 0,
  viewedState: {
    currentMessageIndex: 3,
    lastViewedMessageIndex: 3,
    reviewTargetMessageIndex: 3,
    newMessageCount: 0,
    viewedInCcp: true,
    viewedInHerdr: false,
    viewedAnywhere: true,
  },
};

function livePanes(): HerdrPaneIndexData {
  return {
    panes: [
      {
        paneId: `pane-${SESSION_ID}`,
        terminalId: "t1",
        workspaceId: "w1",
        tabId: "tab1",
        focused: false,
        cwd: null,
        foregroundCwd: null,
        agentStatus: "idle",
        agent: "claude",
        terminalTitle: null,
        agentSessionId: SESSION_ID,
        revision: 1,
        sessionId: SESSION_ID,
        via: "agent-session",
        viewedState: detail.viewedState,
      },
    ],
    writesEnabled: false,
  };
}

const writeText = vi.fn<(text: string) => Promise<void>>();
const onToggleReviewed = vi.fn<() => Promise<unknown>>();
const onGenerateSummary = vi.fn<() => void>();

type ResizeCallback = (entries: Array<{ contentRect: { width: number } }>) => void;

class TestResizeObserver {
  constructor(_callback: ResizeCallback) {}
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function localActions(
  overrides: Partial<SessionHeaderLocalActions> = {},
): SessionHeaderLocalActions {
  return {
    resumeCommand: RESUME_COMMAND,
    forkCommand: FORK_COMMAND,
    reviewed: true,
    onToggleReviewed,
    onGenerateSummary,
    generatingSummary: false,
    ...overrides,
  };
}

async function renderTitlebar(local: SessionHeaderLocalActions, { live = true } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity, refetchOnMount: false },
    },
  });
  queryClient.setQueryData(
    herdrPanesQueryOptions.queryKey,
    live ? livePanes() : { panes: [], writesEnabled: false },
  );
  queryClient.setQueryData(sessionOpenInQueryOptions(SESSION_ID).queryKey, {
    cwd: PROJECT_PATH,
    bridgeSessionId: null,
  });
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <SessionTitlebar sessionId={SESSION_ID} data={detail} isActive={false} local={local} />
        </ToastProvider>
      </QueryClientProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [`/session/${SESSION_ID}`] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  await flush();
  return router;
}

async function openHeaderMenu(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("button", { name: `More options for ${TITLE}` }));
  await flush();
  return screen.getByRole("menu");
}

function menuShape(menu: HTMLElement): string[] {
  return [...menu.querySelectorAll('[role="menuitem"], [role="separator"]')].map((element) =>
    element.getAttribute("role") === "separator" ? "---" : (element.textContent ?? ""),
  );
}

function modelShape(entries: SessionMenuEntry[]): string[] {
  return entries.flatMap((entry) => {
    if (entry.kind === "separator") return ["---"];
    if (entry.kind === "hotkey") return [];
    const keycap =
      entry.accelerator === undefined || entry.hiddenAccelerator === true
        ? ""
        : entry.accelerator.toUpperCase();
    return [`${entry.label}${keycap}`];
  });
}

async function select(label: string) {
  await openHeaderMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: label }));
  await flush();
}

beforeEach(() => {
  installLocalStorage();
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ ok: true })),
  );
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  onToggleReviewed.mockReset();
  onToggleReviewed.mockResolvedValue(undefined);
  onGenerateSummary.mockReset();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  __unreadStoreTesting.reset();
  __unreadStoreTesting.setPersist(() => Promise.resolve());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  __unreadStoreTesting.reset();
});

describe("session header menu", () => {
  it("renders the upstream header model, a separator, then the local section", async () => {
    await renderTitlebar(localActions());
    const menu = await openHeaderMenu();

    const model = getSessionMenuItems(
      {
        title: TITLE,
        pinned: false,
        readState: "read",
        archived: false,
        prUrl: null,
        hasLivePane: true,
        forkDisabledReason: null,
        cwd: PROJECT_PATH,
        bridgeSessionId: null,
      },
      SESSION_MENU_CAPABILITIES,
      { surface: "header" },
    );

    expect(menuShape(menu)).toStrictEqual([
      ...modelShape(model),
      "---",
      "Copy session ID",
      "Copy resume command",
      "Copy fork command",
      "Download raw JSONL",
      "Pin",
      "Mark unreviewed",
      "Open live terminal",
      "Generate AI summary",
    ]);
  });

  it("flips the toggles and drops items with nothing to act on", async () => {
    await renderTitlebar(localActions({ reviewed: false, onGenerateSummary: undefined }), {
      live: false,
    });
    await select("Pin");
    const menu = await openHeaderMenu();
    const shape = menuShape(menu);

    expect(shape.slice(shape.lastIndexOf("---") + 1)).toStrictEqual([
      "Copy session ID",
      "Copy resume command",
      "Copy fork command",
      "Download raw JSONL",
      "Unpin",
      "Mark reviewed",
    ]);
  });

  it("shows a pending summary as a disabled item", async () => {
    await renderTitlebar(localActions({ generatingSummary: true }));
    await openHeaderMenu();

    const item = screen.getByRole("menuitem", { name: "Generating summary…" });
    expect(item.getAttribute("aria-disabled")).toBe("true");
  });

  it("wires each local item to its handler", async () => {
    const clicks: Array<{ href: string; download: string }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push({ href: this.getAttribute("href") ?? "", download: this.download });
    });
    const router = await renderTitlebar(localActions());

    await select("Copy session ID");
    await select("Copy resume command");
    await select("Copy fork command");
    await select("Download raw JSONL");
    await select("Pin");
    const pinState = readPinState();
    await select("Mark unreviewed");
    await select("Generate AI summary");
    await select("Open live terminal");

    expect({
      clipboard: writeText.mock.calls,
      downloads: clicks,
      pinState,
      reviewedToggles: onToggleReviewed.mock.calls.length,
      summaryRequests: onGenerateSummary.mock.calls.length,
      href: router.state.location.href,
    }).toStrictEqual({
      clipboard: [[SESSION_ID], [RESUME_COMMAND], [FORK_COMMAND]],
      downloads: [{ href: `/api/raw?sessionId=${SESSION_ID}`, download: "" }],
      pinState: { pinnedIds: [SESSION_ID], pinnedOrder: [] },
      reviewedToggles: 1,
      summaryRequests: 1,
      href: `/session/${SESSION_ID}?pane=terminal`,
    });
  });

  it("reports a failed review toggle in a toast", async () => {
    onToggleReviewed.mockRejectedValueOnce(new Error("fabricated toggle failure"));
    await renderTitlebar(localActions());

    await select("Mark unreviewed");

    expect(screen.getByText("Couldn’t mark the session unreviewed. Try again.").textContent).toBe(
      "Couldn’t mark the session unreviewed. Try again.",
    );
  });
});

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

async function renderSessionPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(sessionDetailQueryOptions(SESSION_ID).queryKey, detail);
  queryClient.setQueryData(transcriptQueryOptions(SESSION_ID).queryKey, {
    records: [],
    byteOffset: 0,
    startIndex: 0,
    precedingMessageCount: 0,
  });
  queryClient.setQueryData(sessionSubagentsQueryOptions(SESSION_ID).queryKey, []);
  queryClient.setQueryData(herdrPanesQueryOptions.queryKey, livePanes());
  queryClient.setQueryData(sessionOpenInQueryOptions(SESSION_ID).queryKey, {
    cwd: PROJECT_PATH,
    bridgeSessionId: null,
  });
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <SettingsProvider>
          <ClaudeEventsProvider>
            <ToastProvider>
              <SessionPage sessionId={SESSION_ID} />
            </ToastProvider>
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

describe("session page header", () => {
  it("moves the local icon buttons into the chevron menu", async () => {
    vi.stubGlobal("EventSource", TestEventSource);
    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );

    await renderSessionPage();
    const removedIcons = [
      "Copy session ID",
      "Copy resume command",
      "Copy fork command",
      "Download raw JSONL",
      "Star session",
      "Mark reviewed",
      "Mark unreviewed",
      `Open live read-only terminal for ${TITLE}`,
    ].filter((name) => screen.queryByTitle(name) !== null);
    const summaryButton = screen.queryByRole("button", { name: "Generate AI summary" });
    const menu = await openHeaderMenu();
    const shape = menuShape(menu);

    expect({
      removedIcons,
      summaryButton,
      local: shape.slice(shape.lastIndexOf("---") + 1),
    }).toStrictEqual({
      removedIcons: [],
      summaryButton: null,
      local: [
        "Copy session ID",
        "Copy resume command",
        "Copy fork command",
        "Download raw JSONL",
        "Pin",
        "Mark unreviewed",
        "Open live terminal",
        "Generate AI summary",
      ],
    });
  });
});
