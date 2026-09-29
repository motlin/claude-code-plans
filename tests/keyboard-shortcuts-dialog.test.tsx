// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { CommandPalette } from "../src/components/command-palette";
import { ToastProvider } from "../src/components/toast";
import {
  KeyboardShortcutsDialog,
  setKeyboardShortcutsOpen,
  shortcutSections,
} from "../src/components/keyboard-shortcuts-dialog";
import { SHORTCUT_IDS, SHORTCUTS } from "../src/lib/shortcuts/registry";

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

function renderWithComposer() {
  render(
    <>
      <textarea aria-label="Composer" />
      <KeyboardShortcutsDialog />
    </>,
  );
  const composer = screen.getByRole("textbox", { name: "Composer" });
  composer.focus();
  return composer;
}

function pressShortcutsKey(target: Element, init: KeyboardEventInit = { metaKey: true }) {
  fireEvent.keyDown(target, { key: "/", code: "Slash", ...init });
}

function sectionHeadings(region: HTMLElement): string[] {
  return [...region.querySelectorAll(":scope > div > div:first-child")].map(
    (heading) => heading.textContent ?? "",
  );
}

function rowLabels(region: HTMLElement): string[] {
  return [...region.querySelectorAll(":scope > div > div + div > span:first-child")].map(
    (label) => label.textContent ?? "",
  );
}

describe("KeyboardShortcutsDialog", () => {
  beforeEach(() => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_UA);
  });

  afterEach(() => {
    act(() => setKeyboardShortcutsOpen(false));
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("opens on ⌘/ from a focused textarea", async () => {
    const composer = renderWithComposer();

    pressShortcutsKey(composer);

    const dialog = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    expect({
      heading: within(dialog).getByRole("heading", { level: 2 }).textContent,
      region: within(dialog).getByRole("region", { name: "Keyboard shortcuts" }).tabIndex,
      close: within(dialog).getByRole("button", { name: "Close" }).tagName,
    }).toStrictEqual({ heading: "Keyboard shortcuts", region: 0, close: "BUTTON" });
  });

  it("matches the physical Slash key so non-US layouts work", async () => {
    const composer = renderWithComposer();

    pressShortcutsKey(composer, { metaKey: true, key: "-" });

    await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
  });

  it("does not open on ⇧⌘/", () => {
    const composer = renderWithComposer();

    pressShortcutsKey(composer, { metaKey: true, shiftKey: true, key: "?" });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens on Ctrl+/ off mac", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (X11; Linux x86_64)");
    const composer = renderWithComposer();

    pressShortcutsKey(composer, { ctrlKey: true });

    await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
  });

  it("stops other listeners from seeing the ⌘/ event", async () => {
    const composer = renderWithComposer();
    const later = vi.fn();
    document.addEventListener("keydown", later);

    pressShortcutsKey(composer);

    await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    document.removeEventListener("keydown", later);
    expect(later).not.toHaveBeenCalled();
  });

  it("lists only enabled registry entries, grouped in upstream order", async () => {
    const composer = renderWithComposer();
    pressShortcutsKey(composer);

    const dialog = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    const region = within(dialog).getByRole("region", { name: "Keyboard shortcuts" });
    expect({ sections: sectionHeadings(region), rows: rowLabels(region) }).toStrictEqual({
      sections: ["General", "Panes"],
      rows: [
        "Search or start a session",
        "Search",
        "Switch between recents",
        "Toggle sidebar",
        "Keyboard shortcuts",
        "Settings",
        "New session",
        "Rename session",
        "Archive session",
        "Mark session as read/unread",
        "Copy session link",
        "Open session PR",
        "Fork session",
        "Transcript view",
        "Toggle changes",
        "Toggle file list in changes or files",
        "Go to file in changes",
        "Toggle Files",
        "Attach selection as context",
        "Toggle terminal",
        "Close pane",
        "Expand or collapse pane",
        "Toggle side chat",
      ],
    });
  });

  it("renders each row's keys as keycaps for the current platform", async () => {
    const composer = renderWithComposer();
    pressShortcutsKey(composer);

    const dialog = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    const row = within(dialog).getByText("Settings").parentElement;
    expect(
      [...(row?.querySelectorAll("kbd") ?? [])].map((kbd) => kbd.textContent ?? ""),
    ).toStrictEqual(["⇧Shift", "⌘Command", ","]);
  });

  it("lists Search with ⇧⌘K keycaps", async () => {
    const composer = renderWithComposer();
    pressShortcutsKey(composer);

    const dialog = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    const row = within(dialog).getByText("Search").parentElement;
    expect(
      [...(row?.querySelectorAll("kbd") ?? [])].map((kbd) => kbd.textContent ?? ""),
    ).toStrictEqual(["⇧Shift", "⌘Command", "K"]);
  });

  it("closes on Escape and returns focus to the composer", async () => {
    const composer = renderWithComposer();
    pressShortcutsKey(composer);
    const dialog = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });

    fireEvent.keyDown(dialog, { key: "Escape", code: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(composer));
  });

  it("closes on the Close button", async () => {
    const composer = renderWithComposer();
    pressShortcutsKey(composer);
    const dialog = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });

    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("shortcutSections", () => {
  it("groups General, Panes, Composer and drops empty groups", () => {
    const allEnabled = shortcutSections(SHORTCUT_IDS, () => true);
    const noneInComposer = shortcutSections(
      SHORTCUT_IDS,
      (id) => SHORTCUTS[id].group !== "composer",
    );

    expect({
      all: allEnabled.map((section) => section.title),
      firstComposer: allEnabled[2]?.ids[0],
      lastComposer: allEnabled[2]?.ids.at(-1),
      noComposer: noneInComposer.map((section) => section.title),
    }).toStrictEqual({
      all: ["General", "Panes", "Composer"],
      firstComposer: "open_mode_menu",
      lastComposer: "fork_with_prompt",
      noComposer: ["General", "Panes"],
    });
  });
});

describe("Command palette Keyboard shortcuts item", () => {
  beforeEach(() => {
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
    act(() => setKeyboardShortcutsOpen(false));
    cleanup();
    vi.unstubAllGlobals();
  });

  it("opens the shortcuts dialog", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const rootRoute = createRootRoute({
      component: () => (
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <CommandPalette open onOpenChange={() => {}} />
            <KeyboardShortcutsDialog />
          </ToastProvider>
        </QueryClientProvider>
      ),
    });
    const router = createRouter({
      routeTree: rootRoute,
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    await router.load();
    render(<RouterProvider router={router} />);

    fireEvent.click(await screen.findByRole("option", { name: "Keyboard shortcuts" }));

    await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
  });
});
