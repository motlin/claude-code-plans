// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { SessionActionsMenu } from "../src/components/session-actions-menu";
import { SessionTitleHeading } from "../src/components/session-title-heading";
import { ToastProvider } from "../src/components/toast";
import { herdrPanesQueryOptions } from "../src/lib/api/herdr";
import type { SessionListItem } from "../src/lib/api/sessions";
import { __unreadStoreTesting } from "../src/lib/unread-store";

const SESSION_ID = "8f0c2c7e-1111-4222-8333-944445555666";
const CWD = "/Users/alice/it's alpha";

const session: SessionListItem = {
  id: SESSION_ID,
  title: "Fix the flaky test",
  mtime: "2026-09-28T10:00:00.000Z",
  created: "2026-09-28T09:00:00.000Z",
  project: "-Users-alice-it-s-alpha",
  projectName: "alpha",
  messageCount: 4,
  starred: false,
  archived: false,
  state: "ended",
  bucket: "done",
  liveAgentCount: 0,
  unseen: false,
  blockedSince: null,
};

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
const writeText = vi.fn<(text: string) => Promise<void>>();
const openMock = vi.fn<typeof window.open>();

function calls(): Array<{ url: string; method: string; body: unknown }> {
  return fetchMock.mock.calls.map(([input, init]) => ({
    url: String(input),
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

function toastText(): string | null | undefined {
  return document.querySelector("[data-toast-message]")?.textContent;
}

async function openSubmenu(bridgeSessionId: string | null): Promise<string[]> {
  fetchMock.mockImplementation(async (input) => {
    if (String(input) === `/api/sessions/${SESSION_ID}/open-in`) {
      return Response.json({ cwd: CWD, bridgeSessionId });
    }
    return Response.json({ ok: true });
  });
  await renderWithProviders(
    <SessionActionsMenu session={session}>
      <a href={`/session/${SESSION_ID}`}>Row title</a>
    </SessionActionsMenu>,
  );
  fireEvent.contextMenu(screen.getByText("Row title"), { clientX: 40, clientY: 50 });
  await flush();
  const trigger = await screen.findByRole("menuitem", { name: /Open in/ });
  act(() => trigger.focus());
  fireEvent.keyDown(trigger, { key: "ArrowRight" });
  await flush();
  const submenu = screen.getAllByRole("menu")[1];
  if (submenu === undefined) throw new Error("Open in submenu did not open");
  return [...submenu.querySelectorAll('[role="menuitem"]')].map(
    (node) => `${node.textContent ?? ""} [${node.getAttribute("aria-keyshortcuts") ?? ""}]`,
  );
}

function clickItem(name: string) {
  fireEvent.click(screen.getByRole("menuitem", { name: new RegExp(`^${name}`) }));
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("open", openMock);
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  openMock.mockReset();
  openMock.mockReturnValue(null);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  __unreadStoreTesting.reset();
  __unreadStoreTesting.setPersist(() => Promise.resolve());
});

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  __unreadStoreTesting.reset();
});

describe("Open in ▸ in the row menu", () => {
  it("lists claude.ai only when the transcript has a bridge session", async () => {
    expect(await openSubmenu("cse_alice_100")).toEqual([
      "Terminal1 [1]",
      "VS Code2 [2]",
      "Finder3 [3]",
      "claude.ai4 [4]",
    ]);
  });

  it("omits claude.ai without a bridge session", async () => {
    expect(await openSubmenu(null)).toEqual(["Terminal1 [1]", "VS Code2 [2]", "Finder3 [3]"]);
  });

  it("copies the shell-escaped resume command and toasts", async () => {
    await openSubmenu(null);

    clickItem("Terminal");
    await flush();

    expect(writeText.mock.calls).toEqual([
      [`cd '/Users/alice/it'\\''s alpha' && claude -r ${SESSION_ID}`],
    ]);
    await waitFor(() =>
      expect(toastText()).toBe("Command copied. Paste it in a terminal to open this session."),
    );
  });

  it("opens the folder in VS Code", async () => {
    await openSubmenu(null);

    clickItem("VS Code");
    await flush();

    expect(openMock.mock.calls).toEqual([["vscode://file/Users/alice/it's%20alpha", "_self"]]);
  });

  it("asks the server to reveal the session directory in Finder", async () => {
    await openSubmenu(null);

    clickItem("Finder");
    await flush();

    expect(calls().filter((call) => call.method === "POST")).toEqual([
      { url: "/api/open-in-finder", method: "POST", body: { sessionId: SESSION_ID } },
    ]);
  });

  it("opens the bridge session on claude.ai in a new tab", async () => {
    await openSubmenu("cse_alice_100");

    clickItem("claude.ai");
    await flush();

    expect(openMock.mock.calls).toEqual([
      ["https://claude.ai/code/cse_alice_100", "_blank", "noopener,noreferrer"],
    ]);
  });
});

describe("⌥⌘L on the session page", () => {
  it("copies the session link and toasts", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    );
    await renderWithProviders(
      <SessionTitleHeading sessionId={SESSION_ID} title="Fix the flaky test" archived={false} />,
    );

    fireEvent.keyDown(document.body, { key: "¬", code: "KeyL", metaKey: true, altKey: true });
    await flush();

    expect(writeText.mock.calls).toEqual([[`${window.location.origin}/session/${SESSION_ID}`]]);
    await waitFor(() => expect(toastText()).toBe("Link copied to clipboard."));
  });
});
