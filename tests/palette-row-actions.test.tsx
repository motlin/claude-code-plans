// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useRouterState,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { CommandPalette, PALETTE_RECENT_LIMIT } from "../src/components/command-palette";
import { ToastProvider } from "../src/components/toast";
import { useCommandPalette } from "../src/hooks/use-command-palette";
import { recentSessionsQueryOptions } from "../src/lib/api/sessions";
import { clearAll, hasUnseenWork } from "../src/lib/unread-store";

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

function recentSession(id: string, title: string) {
  return {
    id,
    title,
    summary: undefined,
    mtime: new Date().toISOString(),
    created: new Date().toISOString(),
    project: "/users/dev/project-a",
    projectName: "project-a",
    messageCount: 1,
    gitBranch: undefined,
    starred: false,
    state: "unknown" as const,
    bucket: "done" as const,
    liveAgentCount: 0,
    unseen: false,
    blockedSince: null,
  };
}

function Location() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return <output aria-label="Location">{pathname}</output>;
}

function Harness() {
  const palette = useCommandPalette();
  return (
    <>
      <textarea aria-label="Composer" />
      <Location />
      <CommandPalette {...palette} />
    </>
  );
}

async function openPalette() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(recentSessionsQueryOptions(PALETTE_RECENT_LIMIT).queryKey, {
    sessions: [
      recentSession("sess-1", "Refactor auth module"),
      recentSession("sess-2", "Write release notes"),
    ],
    nextCursor: null,
  });
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <Harness />
          <Outlet />
        </ToastProvider>
      </QueryClientProvider>
    ),
  });
  const sessionRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "session/$id",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([sessionRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  const composer = await screen.findByRole("textbox", { name: "Composer" });
  composer.focus();
  fireEvent.keyDown(composer, { key: "k", code: "KeyK", metaKey: true });
  const dialog = await screen.findByRole("dialog", { name: "Search" });
  await within(dialog).findByRole("option", { name: /Refactor auth module/ });
  return { dialog, input: within(dialog).getByRole("combobox", { name: "Search" }) };
}

async function openCard() {
  const opened = await openPalette();
  fireEvent.keyDown(opened.input, { key: "ArrowRight", code: "ArrowRight" });
  const card = await within(opened.dialog).findByRole("menu", { name: "Actions" });
  return { ...opened, card };
}

function menuItems(card: HTMLElement) {
  return within(card)
    .getAllByRole("menuitem")
    .map((item) => [item.textContent, item.getAttribute("aria-keyshortcuts")]);
}

describe("palette row actions card", () => {
  const writeText = vi.fn(() => Promise.resolve());
  const fetchMock = vi.fn(() => new Promise<Response>(() => {}));

  beforeEach(() => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_UA);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    Element.prototype.scrollIntoView = () => {};
    clearAll();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    writeText.mockClear();
    fetchMock.mockClear();
  });

  it("→ opens the card for the selected session row with focus on Open", async () => {
    const { card, input } = await openCard();

    await waitFor(() =>
      expect(document.activeElement).toBe(within(card).getByRole("menuitem", { name: /^Open1/ })),
    );
    expect({
      heading: card.querySelector("[data-palette-card-title]")?.textContent,
      meta: card.querySelector("[data-palette-card-meta]")?.textContent,
      items: menuItems(card),
      inputFocused: document.activeElement === input,
    }).toStrictEqual({
      heading: "Refactor auth module",
      meta: "Session · Just now",
      items: [
        ["Open1", "1"],
        ["Open in new tab2", "2"],
        ["Copy link3", "3"],
        ["Pin4", "4"],
        ["Mark as unread5", "5"],
      ],
      inputFocused: false,
    });
  });

  it("opens from the row's hover … button", async () => {
    const { dialog } = await openPalette();

    const buttons = dialog.querySelectorAll("[data-palette-row-actions-button]");
    expect(buttons.length).toBe(2);
    fireEvent.click(buttons[1]!);

    const card = await within(dialog).findByRole("menu", { name: "Actions" });
    expect(card.querySelector("[data-palette-card-title]")?.textContent).toBe(
      "Write release notes",
    );
  });

  it("number keys activate items", async () => {
    const { card } = await openCard();

    fireEvent.keyDown(card, { key: "3", code: "Digit3" });

    await waitFor(() =>
      expect(writeText.mock.calls).toStrictEqual([["http://localhost:3000/session/sess-1"]]),
    );
    expect(await screen.findByText("Link copied to clipboard.")).toBeTruthy();
    expect(screen.queryByRole("menu", { name: "Actions" })).toBeNull();
  });

  it("marks the session unread from the card", async () => {
    const { card } = await openCard();

    fireEvent.keyDown(card, { key: "5", code: "Digit5" });

    expect(hasUnseenWork("sess-1")).toBe(true);
  });

  it("stars the session from the card", async () => {
    const { card } = await openCard();

    fireEvent.keyDown(card, { key: "4", code: "Digit4" });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls.at(-1)).toStrictEqual([
      "/api/sessions/sess-1/starred",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ starred: true }) }),
    ]);
  });

  it("opens in a new tab with 2", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { card } = await openCard();

    fireEvent.keyDown(card, { key: "2", code: "Digit2" });

    expect(open.mock.calls).toStrictEqual([
      ["http://localhost:3000/session/sess-1", "_blank", "noopener,noreferrer"],
    ]);
  });

  it("opens the session with 1 and closes the palette", async () => {
    const { card } = await openCard();

    fireEvent.keyDown(card, { key: "1", code: "Digit1" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("status", { name: "Location" }).textContent).toBe("/session/sess-1");
  });

  it("← closes the card and returns focus to the row", async () => {
    const { card, input, dialog } = await openCard();

    fireEvent.keyDown(card, { key: "ArrowLeft", code: "ArrowLeft" });

    await waitFor(() => expect(within(dialog).queryByRole("menu")).toBeNull());
    expect({
      focused: document.activeElement === input,
      selected: within(dialog)
        .getAllByRole("option", { selected: true })
        .map((option) => option.textContent),
    }).toStrictEqual({ focused: true, selected: ["Refactor auth module"] });
  });

  it("Esc closes the card first, then the palette", async () => {
    const { card, input, dialog } = await openCard();

    fireEvent.keyDown(card, { key: "Escape", code: "Escape" });

    await waitFor(() => expect(within(dialog).queryByRole("menu")).toBeNull());
    expect(screen.getByRole("dialog", { name: "Search" })).toBe(dialog);
    expect(document.activeElement).toBe(input);

    fireEvent.keyDown(input, { key: "Escape", code: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
