// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { TileHost } from "../src/components/panes/tile-host";
import {
  TerminalPaneShortcut,
  terminalShortcutAction,
  useRegisterTerminalPane,
} from "../src/components/panes/terminal-pane";
import { SettingsProvider } from "../src/components/settings-provider";
import { SessionPaneControls } from "../src/components/view-options-menu";
import { validateSessionSearch } from "../src/lib/session-search";
import { installLocalStorage } from "./fake-storage";

vi.mock("../src/components/herdr-terminal", () => ({
  HerdrTerminal: ({ sessionId }: { sessionId: string }) => (
    <p data-testid="herdr-terminal">{sessionId}</p>
  ),
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

function Harness({ available }: { available: boolean }) {
  useRegisterTerminalPane(SESSION_ID, available);
  return (
    <>
      <TerminalPaneShortcut available={available} />
      <SessionPaneControls facts={{}} />
      <textarea aria-label="Composer" />
    </>
  );
}

function renderSession(
  available: boolean,
  requested: { pane?: "terminal"; onHandled?: () => void } = {},
) {
  return render(
    <SettingsProvider>
      <TileHost
        sessionId={SESSION_ID}
        onExpandWithoutPane={() => {}}
        requestedPane={requested.pane}
        onRequestedPaneHandled={requested.onHandled}
      >
        <Harness available={available} />
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
