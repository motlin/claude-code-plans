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

import { SessionActionsMenu, SessionRowTitle } from "../src/components/session-actions-menu";
import { SessionTitleHeading } from "../src/components/session-title-heading";
import { ToastProvider } from "../src/components/toast";
import { herdrPanesQueryOptions } from "../src/lib/api/herdr";
import type { SessionListItem } from "../src/lib/api/sessions";
import { __unreadStoreTesting } from "../src/lib/unread-store";

const SESSION_ID = "8f0c2c7e-1111-4222-8333-944445555666";
const OLD_TITLE = "Fix the flaky test";
const FAILURE_TOAST = "Couldn’t save the new name. Try again.";

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

function okResponse(title: string): Response {
  return Response.json({ customTitle: title, title });
}

function renameCalls(): Array<{ url: string; method: string | undefined; body: unknown }> {
  return fetchMock.mock.calls.map(([input, init]) => ({
    url: String(input),
    method: init?.method,
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

function renderHeading() {
  return renderWithProviders(
    <SessionTitleHeading sessionId={SESSION_ID} title={OLD_TITLE} archived={false} />,
  );
}

function openHeadingRename(): HTMLInputElement {
  fireEvent.click(screen.getByRole("button", { name: `${OLD_TITLE}, rename session` }));
  return screen.getByRole("textbox", { name: "Rename" }) as HTMLInputElement;
}

function toastText(): string | null | undefined {
  return document.querySelector("[data-toast-message]")?.textContent;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  __unreadStoreTesting.reset();
  __unreadStoreTesting.setPersist(() => Promise.resolve());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  __unreadStoreTesting.reset();
});

describe("session title inline rename", () => {
  it("renders the title as a rename button", async () => {
    await renderHeading();

    const button = screen.getByRole("button", { name: `${OLD_TITLE}, rename session` });
    expect(button.closest("h1")?.textContent).toBe(OLD_TITLE);
  });

  it("opens an input with the whole title selected", async () => {
    await renderHeading();

    const input = openHeadingRename();

    expect(document.activeElement).toBe(input);
    expect([input.value, input.selectionStart, input.selectionEnd]).toEqual([
      OLD_TITLE,
      0,
      OLD_TITLE.length,
    ]);
  });

  it("commits the trimmed title on Enter", async () => {
    fetchMock.mockResolvedValue(okResponse("New name"));
    await renderHeading();

    const input = openHeadingRename();
    fireEvent.change(input, { target: { value: "  New name  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await flush();

    expect(renameCalls()).toEqual([
      {
        url: `/api/sessions/${SESSION_ID}/title`,
        method: "PUT",
        body: { title: "New name" },
      },
    ]);
    expect(screen.queryByRole("textbox", { name: "Rename" })).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("New name");
  });

  it("cancels on Escape without calling the API", async () => {
    await renderHeading();

    const input = openHeadingRename();
    fireEvent.change(input, { target: { value: "Discarded" } });
    fireEvent.keyDown(input, { key: "Escape" });
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: "Rename" })).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(OLD_TITLE);
  });

  it("commits on blur", async () => {
    fetchMock.mockResolvedValue(okResponse("Blurred name"));
    await renderHeading();

    const input = openHeadingRename();
    fireEvent.change(input, { target: { value: "Blurred name" } });
    fireEvent.blur(input);
    await flush();

    expect(renameCalls()).toEqual([
      {
        url: `/api/sessions/${SESSION_ID}/title`,
        method: "PUT",
        body: { title: "Blurred name" },
      },
    ]);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Blurred name");
  });

  it("does not call the API when the title is unchanged or blank", async () => {
    await renderHeading();

    fireEvent.keyDown(openHeadingRename(), { key: "Enter" });
    await flush();
    const input = openHeadingRename();
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(OLD_TITLE);
  });

  it("restores the old title and toasts when saving fails", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: "boom" }, { status: 500 }));
    await renderHeading();

    const input = openHeadingRename();
    fireEvent.change(input, { target: { value: "Doomed name" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(toastText()).toBe(FAILURE_TOAST));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(OLD_TITLE);
  });

  it("focuses the rename input on ⌥⌘R", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    );
    await renderHeading();

    fireEvent.keyDown(document.body, { key: "®", code: "KeyR", metaKey: true, altKey: true });
    await flush();

    const input = screen.getByRole("textbox", { name: "Rename" });
    expect(document.activeElement).toBe(input);
  });
});

describe("sidebar row inline rename", () => {
  const session: SessionListItem = {
    id: SESSION_ID,
    title: OLD_TITLE,
    mtime: "2026-09-28T10:00:00.000Z",
    created: "2026-09-28T09:00:00.000Z",
    project: "-projects-alpha",
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

  function renderRow() {
    return renderWithProviders(
      <SessionActionsMenu session={session}>
        <a href={`/session/${SESSION_ID}`} data-testid="row-link">
          <SessionRowTitle />
        </a>
      </SessionActionsMenu>,
    );
  }

  it("turns the row title into an input from the menu's Rename item", async () => {
    fetchMock.mockResolvedValue(okResponse("Renamed row"));
    await renderRow();

    fireEvent.contextMenu(screen.getByText(OLD_TITLE), { clientX: 40, clientY: 50 });
    await flush();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "r" });
    await flush();

    const input = screen.getByRole("textbox", { name: "Rename" }) as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect([input.value, input.selectionStart, input.selectionEnd]).toEqual([
      OLD_TITLE,
      0,
      OLD_TITLE.length,
    ]);

    fireEvent.change(input, { target: { value: "Renamed row" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await flush();

    expect(renameCalls()).toEqual([
      {
        url: `/api/sessions/${SESSION_ID}/title`,
        method: "PUT",
        body: { title: "Renamed row" },
      },
    ]);
    expect(screen.getByTestId("row-link").textContent).toBe("Renamed row");
  });
});
