import { describe, expect, it } from "vite-plus/test";

import {
  formatLinkMessage,
  INITIAL_TERMINAL_LIFECYCLE,
  reduceTerminalLifecycle,
  type TerminalLifecycle,
  type TerminalLifecycleEvent,
  terminalOverlay,
  terminalStatus,
} from "../src/lib/terminal-lifecycle";

function replay(events: readonly TerminalLifecycleEvent[], start = INITIAL_TERMINAL_LIFECYCLE) {
  const links: string[] = [];
  let state: TerminalLifecycle = start;
  for (const event of events) {
    const step = reduceTerminalLifecycle(state, event);
    state = step.state;
    if (step.link !== null) links.push(step.link);
  }
  return { overlay: terminalOverlay(state), status: terminalStatus(state), links };
}

describe("reduceTerminalLifecycle", () => {
  it("shows the loading placeholder until the shell opens", () => {
    expect([
      replay([]),
      replay([{ type: "loaded" }]),
      replay([{ type: "loaded" }, { type: "opened" }]),
    ]).toStrictEqual([
      { overlay: { kind: "placeholder" }, status: "connecting", links: [] },
      { overlay: { kind: "placeholder" }, status: "connecting", links: [] },
      { overlay: null, status: "live", links: [] },
    ]);
  });

  it("writes dim lost and reconnected lines when the socket drops and comes back", () => {
    const dropped = replay([{ type: "loaded" }, { type: "opened" }, { type: "lost" }]);
    const again = replay([
      { type: "loaded" },
      { type: "opened" },
      { type: "lost" },
      { type: "lost" },
      { type: "opened" },
    ]);

    expect({ dropped, again }).toStrictEqual({
      dropped: { overlay: null, status: "reconnecting", links: ["lost"] },
      again: { overlay: null, status: "live", links: ["lost", "restored"] },
    });
  });

  it("offers Restart shell and Reconnect once the shell exits or the socket fails", () => {
    expect([
      replay([{ type: "loaded" }, { type: "opened" }, { type: "exited" }]),
      replay([{ type: "loaded" }, { type: "error", message: "Shell not found" }]),
      replay([{ type: "loaded" }, { type: "start-failed", message: "Session folder not found" }]),
    ]).toStrictEqual([
      {
        overlay: { kind: "ended", title: "Shell exited.", detail: null },
        status: "closed",
        links: [],
      },
      {
        overlay: { kind: "ended", title: "Shell disconnected: Shell not found", detail: null },
        status: "error",
        links: [],
      },
      {
        overlay: {
          kind: "ended",
          title: "Failed to start shell",
          detail: "Session folder not found",
        },
        status: "error",
        links: [],
      },
    ]);
  });

  it("ignores a late socket drop after the shell has exited", () => {
    expect(
      replay([{ type: "loaded" }, { type: "opened" }, { type: "exited" }, { type: "lost" }]),
    ).toStrictEqual({
      overlay: { kind: "ended", title: "Shell exited.", detail: null },
      status: "closed",
      links: [],
    });
  });

  it("reconnects to the same shell or announces a new one after a restart", () => {
    const exited: TerminalLifecycleEvent[] = [
      { type: "loaded" },
      { type: "opened" },
      { type: "exited" },
    ];

    expect([
      replay([...exited, { type: "reconnect" }]),
      replay([...exited, { type: "reconnect" }, { type: "opened" }]),
      replay([...exited, { type: "restart" }, { type: "loaded" }, { type: "opened" }]),
    ]).toStrictEqual([
      { overlay: { kind: "placeholder" }, status: "connecting", links: [] },
      { overlay: null, status: "live", links: [] },
      { overlay: null, status: "live", links: ["new-shell"] },
    ]);
  });

  it("reports a terminal that never loads", () => {
    expect(replay([{ type: "load-failed" }])).toStrictEqual({
      overlay: {
        kind: "load-failed",
        title: "Couldn’t load the terminal. Reload the page to try again.",
      },
      status: "error",
      links: [],
    });
  });
});

describe("formatLinkMessage", () => {
  it("wraps upstream's link messages in dim SGR 2 between CRLFs", () => {
    expect({
      lost: formatLinkMessage("lost", "localhost:7526"),
      restored: formatLinkMessage("restored", "localhost:7526"),
      newShell: formatLinkMessage("new-shell", "localhost:7526"),
    }).toStrictEqual({
      lost: "\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1049l\r\n\x1b[2mConnection to localhost:7526 lost. Reconnecting…\x1b[22m\r\n",
      restored: "\r\n\x1b[2mReconnected.\x1b[22m\r\n",
      newShell: "\r\n\x1b[2mReconnected. This is a new shell.\x1b[22m\r\n",
    });
  });
});
