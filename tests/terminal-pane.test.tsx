// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { TileHost } from "../src/components/panes/tile-host";
import {
  TerminalPaneShortcut,
  terminalShortcutAction,
  useRegisterTerminalPane,
} from "../src/components/panes/terminal-pane";
import { SettingsProvider } from "../src/components/settings-provider";
import { clearShellTabs } from "../src/lib/shell-tabs";
import { terminalTabsStorageKey } from "../src/lib/terminal-tabs";
import { SessionPaneControls } from "../src/components/view-options-menu";
import { validateSessionSearch } from "../src/lib/session-search";
import { installLocalStorage } from "./fake-storage";

vi.mock("../src/components/herdr-terminal", () => ({
  HerdrTerminal: ({ sessionId, interactive }: { sessionId: string; interactive?: boolean }) => (
    <p data-testid="herdr-terminal" data-interactive={String(interactive ?? false)}>
      {sessionId}
    </p>
  ),
}));

vi.mock("../src/components/shell-terminal", () => ({
  ShellTerminal: ({
    ptyKey,
    closeRequested,
    onClosed,
  }: {
    ptyKey: string;
    closeRequested: boolean;
    onClosed: () => void;
  }) => {
    useEffect(() => {
      if (closeRequested) onClosed();
    }, [closeRequested, onClosed]);
    return <p data-testid="shell-terminal">{ptyKey}</p>;
  },
}));

class FakeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

const SESSION_ID = "terminal-pane-session";

function Harness({
  available,
  interactive,
  shells,
}: {
  available: boolean;
  interactive: boolean;
  shells: boolean;
}) {
  useRegisterTerminalPane(SESSION_ID, { livePane: available, interactive, shells });
  return (
    <>
      <TerminalPaneShortcut available={available || shells} />
      <SessionPaneControls facts={{}} />
      <textarea aria-label="Composer" />
    </>
  );
}

interface SessionOptions {
  pane?: "terminal";
  onHandled?: () => void;
  interactive?: boolean;
  shells?: boolean;
}

function sessionTree(available: boolean, requested: SessionOptions) {
  return (
    <SettingsProvider>
      <TileHost
        sessionId={SESSION_ID}
        onExpandWithoutPane={() => {}}
        requestedPane={requested.pane}
        onRequestedPaneHandled={requested.onHandled}
      >
        <Harness
          available={available}
          interactive={requested.interactive ?? false}
          shells={requested.shells ?? false}
        />
      </TileHost>
    </SettingsProvider>
  );
}

function renderSession(available: boolean, requested: SessionOptions = {}) {
  const result = render(sessionTree(available, requested));
  return {
    ...result,
    setAvailable: (next: boolean) => result.rerender(sessionTree(next, requested)),
  };
}

const CTRL_BACKQUOTE = { key: "`", code: "Backquote", ctrlKey: true };

function pressOn(target: Element, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

let storage: ReturnType<typeof installLocalStorage>;

beforeEach(() => {
  storage = installLocalStorage();
  vi.stubGlobal("ResizeObserver", FakeObserver);
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ x: 0, y: 0, width: 1200, height: 800 }),
  );
});

afterEach(() => {
  cleanup();
  clearShellTabs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("terminalShortcutAction", () => {
  it("follows upstream's ⌃` state machine", () => {
    const table = [
      { available: false, open: false, focusedTile: "chat", focusInTerminal: false },
      { available: true, open: false, focusedTile: "chat", focusInTerminal: false },
      { available: true, open: true, focusedTile: "changes", focusInTerminal: false },
      { available: true, open: true, focusedTile: "terminal", focusInTerminal: true },
      { available: true, open: true, focusedTile: "terminal", focusInTerminal: false },
    ] as const;

    expect(table.map((input) => terminalShortcutAction(input))).toStrictEqual([
      "noop",
      "open",
      "focus",
      "close",
      "caret",
    ]);
  });
});

describe("Terminal pane", () => {
  it("hides the Terminal toggle when herdr has no pane for the session", () => {
    renderSession(false);

    expect(screen.queryByRole("button", { name: "Terminal" })).toBeNull();
  });

  it("shows the Terminal toggle first, pressed state and ⌃` shortcut included", () => {
    renderSession(true);

    const toggles = screen
      .getAllByRole("button")
      .filter((button) => button.hasAttribute("aria-pressed"))
      .map((button) => ({
        label: button.getAttribute("aria-label"),
        pressed: button.getAttribute("aria-pressed"),
        keys: button.getAttribute("aria-keyshortcuts"),
      }));
    expect(toggles[0]).toStrictEqual({
      label: "Terminal",
      pressed: "false",
      keys: "Control+Backquote",
    });
  });

  it("opens the Claude tab with the toggle", () => {
    renderSession(true);

    act(() => screen.getByRole("button", { name: "Terminal" }).click());

    expect({
      pressed: screen.getByRole("button", { name: "Terminal" }).getAttribute("aria-pressed"),
      tabs: screen.getAllByRole("tab").map((tab) => ({
        name: tab.textContent,
        selected: tab.getAttribute("aria-selected"),
      })),
      terminal: screen.getByTestId("herdr-terminal").textContent,
    }).toStrictEqual({
      pressed: "true",
      tabs: [{ name: "Claude", selected: "true" }],
      terminal: SESSION_ID,
    });
  });

  it.each([
    [false, "false"],
    [true, "true"],
  ])(
    "makes the Claude tab interactive only when herdr writes are enabled (%s)",
    (writes, expected) => {
      renderSession(true, { interactive: writes });

      act(() => screen.getByRole("button", { name: "Terminal" }).click());

      expect(screen.getByTestId("herdr-terminal").getAttribute("data-interactive")).toBe(expected);
    },
  );

  it("⌃` opens and focuses the pane, and pressing it again inside closes it", () => {
    renderSession(true);
    const composer = screen.getByRole("textbox", { name: "Composer" });
    composer.focus();

    const opened = pressOn(composer, CTRL_BACKQUOTE);
    const afterOpen = screen.getByRole("button", { name: "Terminal" }).getAttribute("aria-pressed");
    const focused = document.activeElement?.getAttribute("aria-label") ?? null;
    const closed = pressOn(document.activeElement ?? document.body, CTRL_BACKQUOTE);

    expect({
      afterOpen,
      focused,
      afterClose: screen.getByRole("button", { name: "Terminal" }).getAttribute("aria-pressed"),
      prevented: [opened.defaultPrevented, closed.defaultPrevented],
    }).toStrictEqual({
      afterOpen: "true",
      focused: "Claude terminal",
      afterClose: "false",
      prevented: [true, true],
    });
  });

  it("⌃` does nothing without a live pane", () => {
    renderSession(false);

    const event = pressOn(document.body, CTRL_BACKQUOTE);

    expect(event.defaultPrevented).toBe(false);
  });
});

describe("Shell tabs", () => {
  function stubShellApi(
    created: Array<{ status: number; body: unknown }>,
    busy: readonly string[] = [],
  ) {
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      if (input === "/api/shell-busy") {
        const { ptyKeys } = z
          .object({ ptyKeys: z.array(z.string()) })
          .parse(JSON.parse(typeof init?.body === "string" ? init.body : "null"));
        return Response.json({ busy: ptyKeys.filter((key) => busy.includes(key)) });
      }
      const next = created.shift();
      if (!next) throw new Error("unexpected shell request");
      return Response.json(next.body, { status: next.status });
    });
    vi.stubGlobal("fetch", fetcher);
    return fetcher;
  }

  async function flush() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  async function openWithShells(ptyKeys: readonly string[], busy: readonly string[] = []) {
    stubShellApi(
      ptyKeys.map((ptyKey) => ({ status: 200, body: { ptyKey } })),
      busy,
    );
    const view = renderSession(true, { shells: true });
    act(() => screen.getByRole("button", { name: "Terminal" }).click());
    for (const [index] of ptyKeys.entries()) {
      fireEvent.click(screen.getByRole("button", { name: "New terminal" }));
      await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(index + 2));
    }
    return view;
  }

  async function openTabMenu(name: string): Promise<HTMLElement> {
    fireEvent.contextMenu(screen.getByRole("tab", { name }), { clientX: 20, clientY: 20 });
    await flush();
    return await waitFor(() => screen.getByRole("menu"));
  }

  async function chooseFromTabMenu(name: string, label: string) {
    const menu = await openTabMenu(name);
    const item = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (node) => node.textContent === label,
    );
    if (item === undefined) throw new Error(`No menu item ${label}`);
    fireEvent.click(item);
    await flush();
  }

  function tabs() {
    return screen.getAllByRole("tab").map((tab) => ({
      name: tab.textContent,
      selected: tab.getAttribute("aria-selected"),
    }));
  }

  it("offers the Terminal pane without a live herdr pane and starts a shell on open", async () => {
    const fetcher = stubShellApi([{ status: 200, body: { ptyKey: "pty-alice-1" } }]);
    renderSession(false, { shells: true });

    act(() => screen.getByRole("button", { name: "Terminal" }).click());
    await screen.findByTestId("shell-terminal");

    expect({
      requests: fetcher.mock.calls.map(([url, init]) => [url, init?.method]),
      tabs: tabs(),
      shell: screen.getByTestId("shell-terminal").textContent,
      claude: screen.queryByTestId("herdr-terminal"),
    }).toStrictEqual({
      requests: [[`/api/sessions/${SESSION_ID}/shell`, "POST"]],
      tabs: [{ name: "Shell", selected: "true" }],
      shell: "pty-alice-1",
      claude: null,
    });
  });

  it("adds numbered Shell tabs after Claude with New terminal and closes them", async () => {
    stubShellApi([
      { status: 200, body: { ptyKey: "pty-alice-1" } },
      { status: 200, body: { ptyKey: "pty-alice-2" } },
    ]);
    renderSession(true, { shells: true });
    act(() => screen.getByRole("button", { name: "Terminal" }).click());

    fireEvent.click(screen.getByRole("button", { name: "New terminal" }));
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "New terminal" }));
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(3));
    const afterAdd = tabs();
    fireEvent.click(screen.getByRole("button", { name: "Close Shell 2" }));
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(2));

    expect({ afterAdd, afterClose: tabs() }).toStrictEqual({
      afterAdd: [
        { name: "Claude", selected: "false" },
        { name: "Shell", selected: "false" },
        { name: "Shell 2", selected: "true" },
      ],
      afterClose: [
        { name: "Claude", selected: "false" },
        { name: "Shell", selected: "true" },
      ],
    });
  });

  it("reports a missing session folder instead of adding a tab", async () => {
    stubShellApi([{ status: 409, body: { error: "Session folder not found" } }]);
    renderSession(true, { shells: true });
    act(() => screen.getByRole("button", { name: "Terminal" }).click());

    fireEvent.click(screen.getByRole("button", { name: "New terminal" }));

    expect({
      alert: (await screen.findByRole("alert")).textContent,
      tabs: tabs(),
    }).toStrictEqual({
      alert: "Session folder not found",
      tabs: [{ name: "Claude", selected: "true" }],
    });
  });

  it("hides New terminal when Shell tabs are turned off", () => {
    renderSession(true, { shells: false });
    act(() => screen.getByRole("button", { name: "Terminal" }).click());

    expect(screen.queryByRole("button", { name: "New terminal" })).toBeNull();
  });

  it("offers Rename, Close and Close other terminals per tab, and Close others alone on Claude", async () => {
    await openWithShells(["pty-alice-1", "pty-alice-2"]);

    const outline = (menu: HTMLElement) =>
      [...menu.querySelectorAll('[role="menuitem"]')].map((node) => node.textContent);
    const shellMenu = outline(await openTabMenu("Shell 2"));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    const claudeMenu = outline(await openTabMenu("Claude"));

    expect({ shellMenu, claudeMenu }).toStrictEqual({
      shellMenu: ["Rename terminal", "Close terminal", "Close other terminals"],
      claudeMenu: ["Close other terminals"],
    });
  });

  it("renames a tab inline and remembers the name", async () => {
    await openWithShells(["pty-alice-1"]);

    await chooseFromTabMenu("Shell", "Rename terminal");
    const input = await waitFor(() => screen.getByRole("textbox", { name: "Rename terminal" }));
    fireEvent.change(input, { target: { value: "  dev server  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await flush();

    expect({
      tabs: tabs(),
      stored: z
        .object({ tabs: z.array(z.object({ title: z.string() }).passthrough()) })
        .passthrough()
        .parse(JSON.parse(storage.getItem(terminalTabsStorageKey(SESSION_ID)) ?? "null"))
        .tabs.map((tab) => tab.title),
    }).toStrictEqual({
      tabs: [
        { name: "Claude", selected: "false" },
        { name: "dev server", selected: "true" },
      ],
      stored: ["dev server"],
    });
  });

  it("closes the other terminals, keeping Claude and the chosen tab", async () => {
    await openWithShells(["pty-alice-1", "pty-alice-2", "pty-alice-3"]);

    await chooseFromTabMenu("Shell 2", "Close other terminals");
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(2));

    expect(tabs()).toStrictEqual([
      { name: "Claude", selected: "false" },
      { name: "Shell 2", selected: "true" },
    ]);
  });

  it("closes the focused tab with Delete or Backspace, but never Claude", async () => {
    await openWithShells(["pty-alice-1", "pty-alice-2"]);

    fireEvent.keyDown(screen.getByRole("tab", { name: "Shell 2" }), { key: "Backspace" });
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(2));
    fireEvent.keyDown(screen.getByRole("tab", { name: "Shell" }), { key: "Delete" });
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(1));
    fireEvent.keyDown(screen.getByRole("tab", { name: "Claude" }), { key: "Delete" });
    await flush();

    expect({
      tabs: tabs(),
      closeClaude: screen.queryByRole("button", { name: "Close Claude" }),
    }).toStrictEqual({ tabs: [{ name: "Claude", selected: "true" }], closeClaude: null });
  });

  it("reorders Shell tabs with Control+Shift+Arrow, never ahead of Claude", async () => {
    await openWithShells(["pty-alice-1", "pty-alice-2"]);

    fireEvent.keyDown(screen.getByRole("tab", { name: "Shell 2" }), {
      key: "ArrowLeft",
      ctrlKey: true,
      shiftKey: true,
    });
    const afterLeft = tabs().map((tab) => tab.name);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Shell 2" }), {
      key: "ArrowLeft",
      ctrlKey: true,
      shiftKey: true,
    });
    const atStart = tabs().map((tab) => tab.name);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Shell 2" }), {
      key: "ArrowRight",
      ctrlKey: true,
      shiftKey: true,
    });

    expect({ afterLeft, atStart, afterRight: tabs().map((tab) => tab.name) }).toStrictEqual({
      afterLeft: ["Claude", "Shell 2", "Shell"],
      atStart: ["Claude", "Shell 2", "Shell"],
      afterRight: ["Claude", "Shell", "Shell 2"],
    });
  });

  it("asks before closing a terminal that is still running a command", async () => {
    await openWithShells(["pty-alice-1", "pty-alice-2"], ["pty-alice-2"]);

    fireEvent.click(screen.getByRole("button", { name: "Close Shell 2" }));
    const dialog = await waitFor(() => screen.getByRole("alertdialog"));
    const asked = {
      text: dialog.textContent,
      tabs: screen.getAllByRole("tab", { hidden: true }).length,
    };
    fireEvent.click(screen.getByRole("button", { name: "Close terminal" }));
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(2));

    expect(asked).toStrictEqual({
      text: "Close terminal?A command is still running in Shell 2. Closing the terminal stops it.CancelClose terminal",
      tabs: 3,
    });
  });

  it("keeps a busy terminal open when the close is cancelled", async () => {
    await openWithShells(["pty-alice-1"], ["pty-alice-1"]);

    fireEvent.keyDown(screen.getByRole("tab", { name: "Shell" }), { key: "Delete" });
    await waitFor(() => screen.getByRole("alertdialog"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

    expect(tabs()).toStrictEqual([
      { name: "Claude", selected: "false" },
      { name: "Shell", selected: "true" },
    ]);
  });

  it("restores the session's tab list from localStorage without starting a new shell", async () => {
    storage.setItem(
      terminalTabsStorageKey(SESSION_ID),
      JSON.stringify({
        tabs: [
          { id: "shell-1", ptyKey: "pty-alice-1", title: "logs" },
          { id: "shell-4", ptyKey: "pty-alice-4", title: "Shell 4" },
        ],
        active: "shell-4",
        opened: 4,
      }),
    );
    const fetcher = stubShellApi([]);
    renderSession(false, { shells: true });

    act(() => screen.getByRole("button", { name: "Terminal" }).click());
    await flush();

    expect({
      tabs: tabs(),
      shells: screen.getAllByTestId("shell-terminal").map((node) => node.textContent),
      requests: fetcher.mock.calls.length,
    }).toStrictEqual({
      tabs: [
        { name: "logs", selected: "false" },
        { name: "Shell 4", selected: "true" },
      ],
      shells: ["pty-alice-1", "pty-alice-4"],
      requests: 0,
    });
  });

  it("offers More terminals when the tabs overflow the strip", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(900);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(300);
    await openWithShells(["pty-alice-1", "pty-alice-2"]);

    fireEvent.click(screen.getByRole("button", { name: "More terminals" }));
    await flush();
    const menu = await waitFor(() => screen.getByRole("menu"));
    const items = [...menu.querySelectorAll('[role="menuitem"]')].map((node) => node.textContent);
    fireEvent.click(
      [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
        (node) => node.textContent === "Claude",
      )!,
    );
    await flush();

    expect({ items, tabs: tabs() }).toStrictEqual({
      items: ["Claude", "Shell", "Shell 2"],
      tabs: [
        { name: "Claude", selected: "true" },
        { name: "Shell", selected: "false" },
        { name: "Shell 2", selected: "false" },
      ],
    });
  });
});

describe("Terminal pane header menu", () => {
  it("pops the terminal out to its /herdr page with Open in new window", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    renderSession(true);
    act(() => screen.getByRole("button", { name: "Terminal" }).click());

    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    const menu = await waitFor(() => screen.getByRole("menu"));
    const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    fireEvent.click(items.find((node) => node.textContent === "Open in new window")!);

    expect({
      items: items.map((node) => node.textContent),
      opened: open.mock.calls,
    }).toStrictEqual({
      items: ["Open in new window"],
      opened: [[`/herdr/terminal/${SESSION_ID}`, "_blank", "noopener"]],
    });
  });
});

describe("Claude tab lifecycle", () => {
  it("shows Session ended with a transcript link when the herdr pane closes", () => {
    const view = renderSession(true);
    act(() => screen.getByRole("button", { name: "Terminal" }).click());

    view.setAvailable(false);
    const panel = screen.getByRole("tabpanel", { name: "Claude terminal" });

    expect({
      tabs: screen.getAllByRole("tab").map((tab) => tab.textContent),
      text: panel.textContent,
      link: screen.getByRole("link", { name: "View transcript" }).getAttribute("href"),
      terminal: screen.queryByTestId("herdr-terminal"),
    }).toStrictEqual({
      tabs: ["Claude"],
      text: "Session endedView transcript",
      link: `/session/${SESSION_ID}`,
      terminal: null,
    });
  });

  it("closes the pane from the transcript link", () => {
    const view = renderSession(true);
    act(() => screen.getByRole("button", { name: "Terminal" }).click());
    view.setAvailable(false);

    fireEvent.click(screen.getByRole("link", { name: "View transcript" }));

    expect(screen.getByRole("button", { name: "Terminal" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });
});

describe("?pane= deep link", () => {
  it("keeps only a known pane kind", () => {
    expect([
      validateSessionSearch({ pane: "terminal" }),
      validateSessionSearch({ pane: "bogus" }),
      validateSessionSearch({ pane: 7 }),
      validateSessionSearch({}),
    ]).toStrictEqual([{ pane: "terminal" }, {}, {}, {}]);
  });

  it("opens the requested pane once the layout loads, then reports it handled", () => {
    const onHandled = vi.fn();
    renderSession(true, { pane: "terminal", onHandled });

    expect({
      pressed: screen.getByRole("button", { name: "Terminal" }).getAttribute("aria-pressed"),
      handled: onHandled.mock.calls.length,
    }).toStrictEqual({ pressed: "true", handled: 1 });
  });
});
