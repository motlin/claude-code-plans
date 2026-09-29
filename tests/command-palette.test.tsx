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
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { CommandPalette, PALETTE_RECENT_LIMIT } from "../src/components/command-palette";
import { useCommandPalette } from "../src/hooks/use-command-palette";
import { recentSessionsQueryOptions } from "../src/lib/api/sessions";

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

type Bucket = "blocked" | "review" | "working" | "done";

function recentSession(id: string, title: string, bucket: Bucket = "done") {
  return {
    id,
    title,
    summary: undefined,
    mtime: new Date(0).toISOString(),
    created: new Date(0).toISOString(),
    project: "/users/dev/project-a",
    projectName: "project-a",
    messageCount: 1,
    gitBranch: undefined,
    starred: false,
    state: "unknown" as const,
    bucket,
    liveAgentCount: 0,
    unseen: false,
    blockedSince: null,
  };
}

function Harness() {
  const palette = useCommandPalette();
  return (
    <>
      <textarea aria-label="Composer" />
      <CommandPalette {...palette} />
    </>
  );
}

async function renderPalette(
  sessions = [recentSession("sess-1", "Refactor auth module")],
  initialPath = "/",
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(recentSessionsQueryOptions(PALETTE_RECENT_LIMIT).queryKey, {
    sessions,
    nextCursor: null,
  });
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <Harness />
        <Outlet />
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
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  const composer = await screen.findByRole("textbox", { name: "Composer" });
  composer.focus();
  return composer;
}

function pressK(target: Element, init: KeyboardEventInit) {
  fireEvent.keyDown(target, { key: "k", code: "KeyK", ...init });
}

async function openPalette(...args: Parameters<typeof renderPalette>) {
  const composer = await renderPalette(...args);
  pressK(composer, { metaKey: true });
  return screen.findByRole("dialog", { name: "Search" });
}

/** Each group heading mapped to its option labels, in DOM order. */
function groupLabels(dialog: HTMLElement): Array<[string, string[]]> {
  return [...dialog.querySelectorAll("[cmdk-group]")]
    .filter((group) => !group.hasAttribute("hidden"))
    .map((group) => [
      group.querySelector("[cmdk-group-heading]")?.textContent ?? "",
      [...group.querySelectorAll("[cmdk-item]")].map(
        (item) => item.querySelector("[data-palette-label]")?.textContent ?? "",
      ),
    ]);
}

function footer(dialog: HTMLElement): Element | null {
  return dialog.querySelector("[data-palette-footer]");
}

describe("CommandPalette shell", () => {
  beforeEach(() => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_UA);
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    Element.prototype.scrollIntoView = () => {};
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("opens on ⌘K with a focused Search combobox textarea", async () => {
    const dialog = await openPalette();

    const input = within(dialog).getByRole("combobox", { name: "Search" });
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect({
      tag: input.tagName,
      placeholder: input.getAttribute("placeholder"),
      rows: input.getAttribute("rows"),
      close: within(dialog).getByRole("button", { name: "Close" }).tagName,
      modes: within(dialog)
        .getAllByRole("radio")
        .map((radio) => [radio.textContent, radio.getAttribute("aria-checked")]),
    }).toStrictEqual({
      tag: "TEXTAREA",
      placeholder: "Search",
      rows: "1",
      close: "BUTTON",
      modes: [
        ["Search", "true"],
        ["Compose⇥Tab", "false"],
      ],
    });
  });

  it("renders sentence-case group headings in upstream order", async () => {
    const dialog = await openPalette();

    await within(dialog).findByRole("option", { name: /Refactor auth module/ });
    expect(
      [...dialog.querySelectorAll("[cmdk-group-heading]")].map((heading) => heading.textContent),
    ).toStrictEqual(["Recents", "Actions"]);
  });

  it("shows the footer only while the query is empty", async () => {
    const dialog = await openPalette();

    expect(footer(dialog)?.textContent).toBe("CloseEscFilters/Actions→Right");

    fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: "auth" } });

    await waitFor(() => expect(footer(dialog)).toBeNull());
  });

  it("closes on Escape", async () => {
    const dialog = await openPalette();

    fireEvent.keyDown(within(dialog).getByRole("combobox"), { key: "Escape", code: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("closes on the Close button", async () => {
    const dialog = await openPalette();

    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("toggles closed on a second ⌘K", async () => {
    const dialog = await openPalette();

    pressK(within(dialog).getByRole("combobox"), { metaKey: true });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("does not open on Ctrl+K on mac", async () => {
    const composer = await renderPalette();

    pressK(composer, { ctrlKey: true });

    await act(async () => {});
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("switches to Compose on Tab and keeps the text", async () => {
    const dialog = await openPalette();
    const input = within(dialog).getByRole("combobox");
    fireEvent.change(input, { target: { value: "fix the parser" } });

    fireEvent.keyDown(input, { key: "Tab", code: "Tab" });

    const composer = await within(dialog).findByRole("combobox", { name: "Write a message…" });
    expect({
      value: (composer as HTMLTextAreaElement).value,
      placeholder: composer.getAttribute("placeholder"),
      rows: composer.getAttribute("rows"),
      compose: within(dialog)
        .getByRole("radio", { name: /Compose/ })
        .getAttribute("aria-checked"),
    }).toStrictEqual({
      value: "fix the parser",
      placeholder: "Write a message…",
      rows: "2",
      compose: "true",
    });

    fireEvent.keyDown(composer, { key: "Tab", code: "Tab" });

    await within(dialog).findByRole("combobox", { name: "Search" });
  });

  it("forces Search mode on ⇧⌘K", async () => {
    const dialog = await openPalette();
    fireEvent.keyDown(within(dialog).getByRole("combobox"), { key: "Tab", code: "Tab" });
    const composer = await within(dialog).findByRole("combobox", { name: "Write a message…" });

    pressK(composer, { metaKey: true, shiftKey: true, key: "K" });

    await within(dialog).findByRole("combobox", { name: "Search" });
  });

  it("opens in Search mode on ⇧⌘K", async () => {
    const composer = await renderPalette();

    pressK(composer, { metaKey: true, shiftKey: true, key: "K" });

    const dialog = await screen.findByRole("dialog", { name: "Search" });
    within(dialog).getByRole("combobox", { name: "Search" });
  });

  it("keeps the palette open on a second ⇧⌘K", async () => {
    const composer = await renderPalette();
    pressK(composer, { metaKey: true, shiftKey: true, key: "K" });
    const dialog = await screen.findByRole("dialog", { name: "Search" });

    pressK(within(dialog).getByRole("combobox"), { metaKey: true, shiftKey: true, key: "K" });

    await act(async () => {});
    expect(screen.getByRole("dialog", { name: "Search" })).toBe(dialog);
  });

  it("does not run the ⌘K toggle on ⇧⌘K", async () => {
    const dialog = await openPalette();

    pressK(within(dialog).getByRole("combobox"), { metaKey: true, shiftKey: true, key: "K" });

    await act(async () => {});
    expect(screen.getByRole("dialog", { name: "Search" })).toBe(dialog);
  });

  it("does not open on Ctrl+Shift+K on mac", async () => {
    const composer = await renderPalette();

    pressK(composer, { ctrlKey: true, shiftKey: true, key: "K" });

    await act(async () => {});
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("forces Search on ⇧⌘K without overwriting the remembered Compose tab", async () => {
    const dialog = await openPalette();
    fireEvent.keyDown(within(dialog).getByRole("combobox"), { key: "Tab", code: "Tab" });
    const composer = await within(dialog).findByRole("combobox", { name: "Write a message…" });
    fireEvent.keyDown(composer, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const outside = screen.getByRole("textbox", { name: "Composer" });

    pressK(outside, { metaKey: true, shiftKey: true, key: "K" });
    const searchDialog = await screen.findByRole("dialog", { name: "Search" });
    const searchInput = await within(searchDialog).findByRole("combobox", { name: "Search" });
    fireEvent.keyDown(searchInput, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    pressK(outside, { metaKey: true });
    const reopened = await screen.findByRole("dialog", { name: "Search" });
    await within(reopened).findByRole("combobox", { name: "Write a message…" });
  });

  it("shows Needs attention, Recents and Actions in the empty state", async () => {
    const dialog = await openPalette(
      [
        recentSession("s-1", "Recent one"),
        recentSession("s-blocked", "Blocked one", "blocked"),
        recentSession("s-current", "Current page", "done"),
        recentSession("s-2", "Recent two", "working"),
        recentSession("s-review", "Review one", "review"),
        recentSession("s-3", "Recent three"),
        recentSession("s-4", "Recent four"),
        recentSession("s-5", "Recent five"),
        recentSession("s-6", "Recent six"),
        recentSession("s-7", "Recent seven"),
      ],
      "/session/s-current",
    );

    await within(dialog).findByRole("option", { name: /Blocked one/ });
    expect(groupLabels(dialog)).toStrictEqual([
      ["Needs attention", ["Blocked one Awaiting input", "Review one Needs review"]],
      ["Recents", ["Recent one", "Recent two", "Recent three", "Recent four", "Recent five"]],
      [
        "Actions",
        [
          "Search sessions",
          "Keyboard shortcuts",
          "Toggle sidebar",
          "Settings",
          "Mark all sessions seen",
        ],
      ],
    ]);
    expect(dialog.querySelectorAll("[data-palette-attention-dot]").length).toBe(2);
  });

  it("caps Needs attention at the organic total of 7", async () => {
    const dialog = await openPalette(
      Array.from({ length: 9 }, (_, index) =>
        recentSession(`s-${index}`, `Waiting ${index}`, "blocked"),
      ),
    );

    await within(dialog).findByRole("option", { name: /Waiting 0/ });
    expect(groupLabels(dialog).map(([heading, labels]) => [heading, labels.length])).toStrictEqual([
      ["Needs attention", 7],
      ["Actions", 5],
    ]);
  });

  it("hides navigation commands until typed", async () => {
    const dialog = await openPalette();

    await within(dialog).findByRole("option", { name: /Refactor auth module/ });
    expect(within(dialog).queryByRole("option", { name: "Plans" })).toBeNull();

    fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: "plan" } });
    await within(dialog).findByRole("option", { name: "Plans" });

    fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: "markdown" } });
    await within(dialog).findByRole("option", { name: "Plans" });
  });
});
