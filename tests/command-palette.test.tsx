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
import { useCommandPalette } from "../src/hooks/use-command-palette";
import { recentSessionsQueryOptions } from "../src/lib/api/sessions";

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

function recentSession(id: string, title: string) {
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
    bucket: "done" as const,
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

async function renderPalette() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(recentSessionsQueryOptions(8).queryKey, {
    sessions: [recentSession("sess-1", "Refactor auth module")],
    nextCursor: null,
  });
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
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

async function openPalette() {
  const composer = await renderPalette();
  pressK(composer, { metaKey: true });
  return screen.findByRole("dialog", { name: "Search" });
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

    expect(footer(dialog)?.textContent).toBe("CloseEscActions→Right");

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
});
