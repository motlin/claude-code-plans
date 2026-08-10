// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { HerdrTerminal } from "../src/components/herdr-terminal";

const terminalState = vi.hoisted(() => ({
  constructorOptions: [] as unknown[],
  closeCalls: [] as unknown[][],
  socketUrls: [] as string[],
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
    terminalState.socketUrls.push(String(url));
  }
  close(...arguments_: unknown[]) {
    terminalState.closeCalls.push(arguments_);
  }
}

describe("live herdr terminal UI", () => {
  beforeEach(() => {
    terminalState.constructorOptions = [];
    terminalState.closeCalls = [];
    terminalState.socketUrls = [];
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("labels the view as read-only and never exposes an input channel", async () => {
    const view = render(<HerdrTerminal sessionId="session-test-100" />);

    // Ghostty instantiates its WebAssembly parser before the terminal exists.
    await waitFor(() => expect(terminalState.socketUrls.length).toBe(1));

    expect({
      regionName: screen.getByRole("region").getAttribute("aria-label"),
      notice: screen.getByText("Live read-only view").textContent,
      authority: screen.getByText("JSONL transcript remains authoritative for session content.")
        .textContent,
      inputs: screen.queryAllByRole("textbox").length,
      terminalOptions: terminalState.constructorOptions,
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
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 13,
          scrollback: 0,
          theme: { background: "#111318", foreground: "#e6e6e6" },
        },
      ],
      socketUrls: [
        "ws://localhost:3000/api/herdr/observe?sessionId=session-test-100&columns=80&rows=24",
      ],
    });

    view.unmount();
    expect(terminalState.closeCalls).toStrictEqual([[1000, "terminal view closed"]]);
  });
});
