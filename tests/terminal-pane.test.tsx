// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { TileHost } from "../src/components/panes/tile-host";
import {
  TerminalPaneShortcut,
  terminalShortcutAction,
  useRegisterTerminalPane,
} from "../src/components/panes/terminal-pane";
import { SettingsProvider } from "../src/components/settings-provider";
import { clearShellTabs } from "../src/lib/shell-tabs";
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

function renderSession(
  available: boolean,
  requested: {
    pane?: "terminal";
    onHandled?: () => void;
    interactive?: boolean;
    shells?: boolean;
  } = {},
) {
  return render(
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
    </SettingsProvider>,
  );
}

const CTRL_BACKQUOTE = { key: "`", code: "Backquote", ctrlKey: true };

function pressOn(target: Element, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

beforeEach(() => {
  installLocalStorage();
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
  function stubShellApi(responses: Array<{ status: number; body: unknown }>) {
    const fetcher = vi.fn<typeof fetch>(async () => {
      const next = responses.shift();
      if (!next) throw new Error("unexpected shell request");
      return Response.json(next.body, { status: next.status });
    });
    vi.stubGlobal("fetch", fetcher);
    return fetcher;
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
