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

import { SessionActionsMenu } from "../src/components/session-actions-menu";
import { SessionTitleHeading } from "../src/components/session-title-heading";
import { SessionRowStatusDot } from "../src/components/session-unread-control";
import { ToastProvider } from "../src/components/toast";
import { herdrPanesQueryOptions } from "../src/lib/api/herdr";
import type { SessionListItem } from "../src/lib/api/sessions";
import type { SessionBucket } from "../src/lib/session-state";
import {
  __unreadStoreTesting,
  hasUnseenWork,
  syncUnseenFromSummaries,
} from "../src/lib/unread-store";

const SESSION_ID = "8f0c2c7e-1111-4222-8333-944445555666";

function listItem(
  bucket: SessionBucket,
  overrides: Partial<SessionListItem> = {},
): SessionListItem {
  return {
    id: SESSION_ID,
    title: "Fix the flaky test",
    mtime: "2026-09-28T10:00:00.000Z",
    created: "2026-09-28T09:00:00.000Z",
    project: "-projects-alpha",
    projectName: "alpha",
    messageCount: 4,
    archived: false,
    state: "ended",
    bucket,
    liveAgentCount: 0,
    unseen: false,
    blockedSince: null,
    ...overrides,
  };
}

const VIEWED_STATE = {
  currentMessageIndex: 3,
  lastViewedMessageIndex: 3,
  reviewTargetMessageIndex: 3,
  newMessageCount: 0,
  viewedInCcp: true,
  viewedInHerdr: false,
  viewedAnywhere: true,
};

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();

function viewedCalls(): Array<{ url: string; method: string; body: unknown }> {
  return fetchMock.mock.calls
    .filter(([input]) => input.endsWith("/viewed"))
    .map(([input, init]) => ({
      url: input,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
    }));
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderWithProviders(content: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity, refetchOnMount: false },
      mutations: { retry: false },
    },
  });
  queryClient.setQueryData(herdrPanesQueryOptions.queryKey, { panes: [], writesEnabled: false });
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>{content}</ToastProvider>
      </QueryClientProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  await flush();
}

async function renderRow(session: SessionListItem) {
  await renderWithProviders(
    <SessionActionsMenu session={session}>
      <a href={`/session/${session.id}`}>Row title</a>
    </SessionActionsMenu>,
  );
}

async function readStateItems(): Promise<string[]> {
  fireEvent.contextMenu(screen.getByText("Row title"), { clientX: 40, clientY: 50 });
  await flush();
  const menu = screen.getByRole("menu");
  return [...menu.querySelectorAll('[role="menuitem"]')]
    .map((node) => `${node.textContent ?? ""} [${node.getAttribute("aria-keyshortcuts") ?? ""}]`)
    .filter((label) => label.startsWith("Mark as"));
}

async function selectItem(name: string) {
  fireEvent.contextMenu(screen.getByText("Row title"), { clientX: 40, clientY: 50 });
  await flush();
  fireEvent.click(screen.getByRole("menuitem", { name: new RegExp(`^${name}`) }));
  await flush();
}

function pressOptionCommandU() {
  fireEvent.keyDown(document.body, { key: "¨", code: "KeyU", metaKey: true, altKey: true });
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async () => Response.json(VIEWED_STATE));
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  );
  __unreadStoreTesting.reset();
});

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  __unreadStoreTesting.reset();
});

describe("read state in the row menu", () => {
  it("labels the item by the row's state", async () => {
    await renderRow(listItem("done"));
    const read = await readStateItems();
    cleanup();

    syncUnseenFromSummaries([{ id: SESSION_ID, unseen: true }]);
    await renderRow(listItem("review", { unseen: true }));
    const unread = await readStateItems();
    cleanup();

    await renderRow(listItem("blocked", { state: "waiting" }));
    const waiting = await readStateItems();

    expect({ read, unread, waiting }).toStrictEqual({
      read: ["Mark as unreadU [u]"],
      unread: ["Mark as readU [u]"],
      waiting: ["Mark as completedU [u]"],
    });
  });

  it("offers no read-state item for a working row", async () => {
    await renderRow(listItem("working", { state: "working" }));

    expect(await readStateItems()).toStrictEqual([]);
  });

  it("round-trips unread and read through the viewed-state API", async () => {
    await renderRow(listItem("done"));

    await selectItem("Mark as unread");
    const afterUnread = hasUnseenWork(SESSION_ID);
    await selectItem("Mark as read");

    expect({
      afterUnread,
      afterRead: hasUnseenWork(SESSION_ID),
      calls: viewedCalls(),
    }).toStrictEqual({
      afterUnread: true,
      afterRead: false,
      calls: [
        {
          url: `/api/sessions/${SESSION_ID}/viewed`,
          method: "PUT",
          body: { action: "unreviewed" },
        },
        { url: `/api/sessions/${SESSION_ID}/viewed`, method: "PUT", body: { action: "reviewed" } },
      ],
    });
  });

  it("acknowledges a waiting row without answering it", async () => {
    syncUnseenFromSummaries([{ id: SESSION_ID, unseen: true }]);
    await renderRow(listItem("blocked", { state: "waiting", unseen: true }));

    await selectItem("Mark as completed");

    expect({ unseen: hasUnseenWork(SESSION_ID), calls: viewedCalls() }).toStrictEqual({
      unseen: false,
      calls: [
        { url: `/api/sessions/${SESSION_ID}/viewed`, method: "PUT", body: { action: "reviewed" } },
      ],
    });
  });
});

describe("status dot toggle", () => {
  function dot(): { label: string | null; title: string | null; kind: string | null } {
    const button = screen.getByRole("button", { name: /^Click to mark as/ });
    return {
      label: button.getAttribute("aria-label"),
      title: button.getAttribute("title"),
      kind: button.querySelector("[data-kind]")?.getAttribute("data-kind") ?? "idle",
    };
  }

  it("toggles a finished row between read and unread", async () => {
    render(<SessionRowStatusDot session={listItem("done")} />);
    const before = dot();

    fireEvent.click(screen.getByRole("button", { name: "Click to mark as unread" }));
    await flush();
    const afterUnread = dot();

    fireEvent.click(screen.getByRole("button", { name: "Click to mark as read" }));
    await flush();

    expect({ before, afterUnread, afterRead: dot(), calls: viewedCalls() }).toStrictEqual({
      before: { label: "Click to mark as unread", title: "Click to mark as unread", kind: "idle" },
      afterUnread: {
        label: "Click to mark as read",
        title: "Click to mark as read",
        kind: "ready",
      },
      afterRead: {
        label: "Click to mark as unread",
        title: "Click to mark as unread",
        kind: "idle",
      },
      calls: [
        {
          url: `/api/sessions/${SESSION_ID}/viewed`,
          method: "PUT",
          body: { action: "unreviewed" },
        },
        { url: `/api/sessions/${SESSION_ID}/viewed`, method: "PUT", body: { action: "reviewed" } },
      ],
    });
  });

  it.each([
    ["working", "working", "running"],
    ["blocked", "waiting", "awaiting"],
  ] as const)("is a plain icon on a %s row", (bucket, state, kind) => {
    const { container } = render(<SessionRowStatusDot session={listItem(bucket, { state })} />);

    expect({
      button: screen.queryByRole("button"),
      kind: container.querySelector("[data-kind]")?.getAttribute("data-kind"),
    }).toStrictEqual({ button: null, kind });
  });
});

describe("⌥⌘U on the session page", () => {
  it("toggles the session between unread and read", async () => {
    await renderWithProviders(
      <SessionTitleHeading sessionId={SESSION_ID} title="Fix the flaky test" archived={false} />,
    );

    pressOptionCommandU();
    await flush();
    const afterFirst = hasUnseenWork(SESSION_ID);
    pressOptionCommandU();
    await flush();

    expect({
      afterFirst,
      afterSecond: hasUnseenWork(SESSION_ID),
      calls: viewedCalls(),
    }).toStrictEqual({
      afterFirst: true,
      afterSecond: false,
      calls: [
        {
          url: `/api/sessions/${SESSION_ID}/viewed`,
          method: "PUT",
          body: { action: "unreviewed" },
        },
        { url: `/api/sessions/${SESSION_ID}/viewed`, method: "PUT", body: { action: "reviewed" } },
      ],
    });
  });
});
