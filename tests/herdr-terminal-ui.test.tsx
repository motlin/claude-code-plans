// @vitest-environment jsdom

import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { HerdrTerminal } from "../src/components/herdr-terminal";
import type { GhosttyAppearance } from "../src/lib/server-fns";

const DEFAULT_APPEARANCE: GhosttyAppearance = {
  fontFamily: '"MesloLGS Nerd Font Mono", "MesloLGS NF Web", "JetBrains Mono", monospace',
  fontSize: 13,
  theme: { background: "#111318", foreground: "#e6e6e6" },
};

const GHOSTTY_APPEARANCE: GhosttyAppearance = {
  fontFamily:
    '"Alice Mono", "MesloLGS Nerd Font Mono", "MesloLGS NF Web", "JetBrains Mono", monospace',
  fontSize: 16,
  theme: {
    background: "#1d1f21",
    foreground: "#c5c8c6",
    cursor: "#dddddd",
    black: "#000000",
    red: "#cc6666",
    brightBlue: "#81a2be",
    brightWhite: "#ffffff",
  },
};

const terminalState = vi.hoisted(() => ({
  constructorOptions: [] as unknown[],
  closeCalls: [] as unknown[][],
  socketUrls: [] as string[],
  webSockets: [] as EventTarget[],
}));

const appearanceState = vi.hoisted(() => ({
  appearance: {} as unknown,
}));

vi.mock("../src/lib/server-fns", () => ({
  getGhosttyAppearance: vi.fn(() => Promise.resolve(appearanceState.appearance)),
}));

vi.mock("ghostty-web", () => ({
  init: vi.fn().mockResolvedValue(undefined),
  Terminal: class {
    cols = 80;
    rows = 24;
    constructor(options: unknown) {
      terminalState.constructorOptions.push(options);
    }
    loadAddon() {}
    open() {}
    reset() {}
    resize(columns: number, rows: number) {
      this.cols = columns;
      this.rows = rows;
    }
    write() {}
    dispose() {}
  },
  FitAddon: class {
    fit() {}
  },
}));

class FakeResizeObserver {
  observe() {}
  disconnect() {}
}

class FakeWebSocket extends EventTarget {
  constructor(url: string | URL) {
    super();
    terminalState.webSockets.push(this);
    terminalState.socketUrls.push(String(url));
  }
  close(...arguments_: unknown[]) {
    terminalState.closeCalls.push(arguments_);
  }
}

/**
 * Ghostty rasterizes glyphs onto a canvas, so the terminal must not be built
 * until the webfont is resident. Tests drive that gate by hand.
 */
let releaseFonts: () => void;
let fontRequests: string[] = [];
let fontLoadResult: () => Promise<unknown> = () => Promise.resolve([]);

function terminalSurface(): HTMLElement {
  const surface = screen.getByRole("region").lastElementChild;
  if (!(surface instanceof HTMLElement)) throw new Error("Expected a terminal surface element");
  return surface;
}

function currentWebSocket(): FakeWebSocket {
  const webSocket = terminalState.webSockets.at(-1);
  if (!(webSocket instanceof FakeWebSocket)) throw new Error("Expected a WebSocket connection");
  return webSocket;
}

async function flushPendingWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("live herdr terminal UI", () => {
  beforeEach(() => {
    terminalState.constructorOptions = [];
    terminalState.closeCalls = [];
    terminalState.socketUrls = [];
    terminalState.webSockets = [];
    appearanceState.appearance = DEFAULT_APPEARANCE;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const ready = new Promise<void>((resolve) => {
      releaseFonts = resolve;
    });
    fontRequests = [];
    fontLoadResult = () => Promise.resolve([]);
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: {
        ready,
        load: (font: string) => {
          fontRequests.push(font);
          return fontLoadResult();
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, "fonts");
  });

  it("labels the view as read-only and never exposes an input channel", async () => {
    appearanceState.appearance = GHOSTTY_APPEARANCE;

    const view = render(<HerdrTerminal sessionId="session-test-100" />);
    releaseFonts();

    // Ghostty instantiates its WebAssembly parser before the terminal exists.
    await waitFor(() => expect(terminalState.socketUrls.length).toBe(1));

    expect({
      regionName: screen.getByRole("region").getAttribute("aria-label"),
      notice: screen.getByText("Live read-only view").textContent,
      authority: screen.getByText("JSONL transcript remains authoritative for session content.")
        .textContent,
      inputs: screen.queryAllByRole("textbox").length,
      terminalOptions: terminalState.constructorOptions,
      surfaceBackground: terminalSurface().style.backgroundColor,
      socketUrls: terminalState.socketUrls,
    }).toStrictEqual({
      regionName: "Live read-only terminal",
      notice: "Live read-only view",
      authority: "JSONL transcript remains authoritative for session content.",
      inputs: 0,
      terminalOptions: [
        {
          convertEol: false,
          cursorBlink: false,
          disableStdin: true,
          fontFamily: GHOSTTY_APPEARANCE.fontFamily,
          fontSize: 16,
          scrollback: 0,
          theme: GHOSTTY_APPEARANCE.theme,
        },
      ],
      surfaceBackground: "rgb(29, 31, 33)",
      socketUrls: [
        "ws://localhost:3000/api/herdr/observe?sessionId=session-test-100&columns=80&rows=24",
      ],
    });

    view.unmount();
    expect(terminalState.closeCalls).toStrictEqual([[1000, "terminal view closed"]]);
  });

  it("falls back to the built-in appearance when Ghostty supplies no configuration", async () => {
    render(<HerdrTerminal sessionId="session-test-100" />);
    releaseFonts();

    await waitFor(() => expect(terminalState.socketUrls.length).toBe(1));

    expect({
      terminalOptions: terminalState.constructorOptions,
      surfaceBackground: terminalSurface().style.backgroundColor,
    }).toStrictEqual({
      terminalOptions: [
        {
          convertEol: false,
          cursorBlink: false,
          disableStdin: true,
          fontFamily: DEFAULT_APPEARANCE.fontFamily,
          fontSize: 13,
          scrollback: 0,
          theme: { background: "#111318", foreground: "#e6e6e6" },
        },
      ],
      surfaceBackground: "rgb(17, 19, 24)",
    });
  });

  it("stops reconnecting when the terminal observer reports an unavailable session", async () => {
    render(<HerdrTerminal sessionId="session-test-100" />);
    releaseFonts();
    await waitFor(() => expect(terminalState.socketUrls.length).toBe(1));

    const webSocket = currentWebSocket();
    act(() => {
      webSocket.dispatchEvent(
        new MessageEvent("message", { data: JSON.stringify({ type: "connected" }) }),
      );
      webSocket.dispatchEvent(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "observer.error",
            message: "Alice terminal is unavailable",
          }),
        }),
      );
      webSocket.dispatchEvent(
        new CloseEvent("close", { code: 1011, reason: "terminal observer failed" }),
      );
    });
    await new Promise((resolve) => setTimeout(resolve, 800));

    expect({
      status: screen.getByText("error").textContent,
      errorMessages: screen
        .getAllByText("Alice terminal is unavailable")
        .map((element) => element.textContent),
      socketUrls: terminalState.socketUrls,
      closeCalls: terminalState.closeCalls,
    }).toStrictEqual({
      status: "error",
      errorMessages: ["Alice terminal is unavailable"],
      socketUrls: [
        "ws://localhost:3000/api/herdr/observe?sessionId=session-test-100&columns=80&rows=24",
      ],
      closeCalls: [],
    });
  });

  it("uses a browser-valid application close code for a malformed observer record", async () => {
    render(<HerdrTerminal sessionId="session-test-100" />);
    releaseFonts();
    await waitFor(() => expect(terminalState.socketUrls.length).toBe(1));

    act(() => {
      currentWebSocket().dispatchEvent(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "alice.malformed" }),
        }),
      );
    });
    await waitFor(() => expect(screen.getByText("error").textContent).toBe("error"));

    expect({
      status: screen.getByText("error").textContent,
      closeCalls: terminalState.closeCalls,
      socketUrls: terminalState.socketUrls,
    }).toStrictEqual({
      status: "error",
      closeCalls: [[4000, "invalid terminal stream"]],
      socketUrls: [
        "ws://localhost:3000/api/herdr/observe?sessionId=session-test-100&columns=80&rows=24",
      ],
    });
  });

  it("waits for the Nerd Font webfont before painting the canvas terminal", async () => {
    appearanceState.appearance = GHOSTTY_APPEARANCE;

    render(<HerdrTerminal sessionId="session-test-100" />);
    await flushPendingWork();
    const constructionsBeforeFontsReady = terminalState.constructorOptions.length;

    releaseFonts();
    await waitFor(() => expect(terminalState.socketUrls.length).toBe(1));

    expect({
      constructionsBeforeFontsReady,
      constructionsAfterFontsReady: terminalState.constructorOptions.length,
      fontRequests,
    }).toStrictEqual({
      constructionsBeforeFontsReady: 0,
      constructionsAfterFontsReady: 1,
      fontRequests: [`16px ${GHOSTTY_APPEARANCE.fontFamily}`],
    });
  });

  it("still renders the terminal when the Ghostty font stack cannot be loaded", async () => {
    appearanceState.appearance = GHOSTTY_APPEARANCE;
    fontLoadResult = () => Promise.reject(new SyntaxError("Could not parse the font shorthand"));

    render(<HerdrTerminal sessionId="session-test-100" />);
    releaseFonts();

    await waitFor(() => expect(terminalState.socketUrls.length).toBe(1));

    expect({
      terminals: terminalState.constructorOptions.length,
      errors: screen.queryAllByText("Could not parse the font shorthand").length,
    }).toStrictEqual({ terminals: 1, errors: 0 });
  });
});
