// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import type { ILink, ILinkProvider } from "ghostty-web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { Composer } from "../src/components/composer";
import { formatContextAttachment, takeContextChips } from "../src/lib/context-attach";
import {
  attachTerminalSelection,
  guardTerminalLinks,
  handleTerminalSelectionKey,
  openLinkPrompt,
  openTerminalLink,
  TERMINAL_ATTACHED_MESSAGE,
  trimTerminalSelection,
} from "../src/lib/terminal-selection";
import { installLocalStorage } from "./fake-storage";

beforeEach(() => {
  installLocalStorage();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function key(
  code: string,
  modifiers: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean },
) {
  return {
    code,
    metaKey: modifiers.metaKey ?? false,
    ctrlKey: modifiers.ctrlKey ?? false,
    shiftKey: modifiers.shiftKey ?? false,
    altKey: modifiers.altKey ?? false,
  };
}

function selecting(text: string) {
  return { hasSelection: () => text !== "", getSelection: () => text };
}

describe("trimTerminalSelection", () => {
  it("drops the cell padding after each line and blank edge lines", () => {
    expect(trimTerminalSelection("\n  $ ls   \nalice.ts    bob.ts   \n\n   \n")).toBe(
      "  $ ls\nalice.ts    bob.ts",
    );
  });

  it("is empty for whitespace alone", () => {
    expect(trimTerminalSelection("   \n  \n")).toBe("");
  });
});

describe("handleTerminalSelectionKey", () => {
  function run(event: ReturnType<typeof key>, text: string) {
    const copied: string[] = [];
    const attached: string[] = [];
    const handled = handleTerminalSelectionKey(event, selecting(text), {
      copy: (value) => copied.push(value),
      attach: (value) => attached.push(value),
    });
    return { handled, copied, attached };
  }

  it("copies the trimmed selection on ⌘C and ⌃⇧C", () => {
    expect([
      run(key("KeyC", { metaKey: true }), "alice   \n"),
      run(key("KeyC", { ctrlKey: true, shiftKey: true }), "bob  "),
    ]).toStrictEqual([
      { handled: true, copied: ["alice"], attached: [] },
      { handled: true, copied: ["bob"], attached: [] },
    ]);
  });

  it("attaches the trimmed selection on ⇧⌘L", () => {
    expect(run(key("KeyL", { metaKey: true, shiftKey: true }), "  carol  \n")).toStrictEqual({
      handled: true,
      copied: [],
      attached: ["  carol"],
    });
  });

  it("leaves the keys to the terminal without a selection or with other chords", () => {
    expect([
      run(key("KeyC", { metaKey: true }), ""),
      run(key("KeyL", { metaKey: true, shiftKey: true }), "  \n "),
      run(key("KeyC", { ctrlKey: true }), "alice"),
      run(key("KeyL", { metaKey: true }), "alice"),
    ]).toStrictEqual([
      { handled: false, copied: [], attached: [] },
      { handled: false, copied: [], attached: [] },
      { handled: false, copied: [], attached: [] },
      { handled: false, copied: [], attached: [] },
    ]);
  });
});

describe("attachTerminalSelection", () => {
  it("adds the selection to the session's composer as a terminal output chip", () => {
    render(<Composer variant="session" draftKey="alice-session" onSend={() => {}} />);
    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Prompt" });

    let delivered = false;
    act(() => {
      delivered = attachTerminalSelection("alice-session", "$ echo ```\n```");
    });
    const otherSession = attachTerminalSelection("bob-session", "bob");

    const chips = takeContextChips("alice-session").map((chip) => ({
      kind: chip.kind,
      text: chip.text,
      sent: formatContextAttachment(chip),
    }));

    expect({
      delivered,
      otherSession,
      value: textarea.value,
      chips,
      message: TERMINAL_ATTACHED_MESSAGE,
    }).toStrictEqual({
      delivered: true,
      otherSession: false,
      value: "",
      chips: [{ kind: "terminal", text: "$ echo ```\n```", sent: "````\n$ echo ```\n```\n````" }],
      message: "Terminal output attached to chat",
    });
  });
});

describe("terminal links", () => {
  it("asks before opening an http(s) link", () => {
    const confirm = vi.fn(() => true);
    const open = vi.fn();
    const opened = openTerminalLink("https://example.com/alice?q=1", { confirm, open });

    expect({
      opened,
      prompts: confirm.mock.calls,
      opens: open.mock.calls,
    }).toStrictEqual({
      opened: true,
      prompts: [["Open link?\n\nHost: example.com\nhttps://example.com/alice?q=1"]],
      opens: [["https://example.com/alice?q=1"]],
    });
  });

  it("does not open a link the user declines", () => {
    const open = vi.fn();
    const opened = openTerminalLink("http://bob.test/", { confirm: () => false, open });
    expect({ opened, opens: open.mock.calls }).toStrictEqual({ opened: false, opens: [] });
  });

  it("ignores non-http links without asking", () => {
    const confirm = vi.fn(() => true);
    const open = vi.fn();
    const results = [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "mailto:alice@example.com",
      "not a url",
    ].map((href) => openTerminalLink(href, { confirm, open }));

    expect({
      results,
      prompts: confirm.mock.calls,
      opens: open.mock.calls,
    }).toStrictEqual({
      results: [false, false, false, false],
      prompts: [],
      opens: [],
    });
  });

  it("formats the confirm with the host", () => {
    expect(openLinkPrompt(new URL("http://localhost:7526/session/alice"))).toBe(
      "Open link?\n\nHost: localhost:7526\nhttp://localhost:7526/session/alice",
    );
  });

  it("routes every provided link through the guard instead of opening it directly", () => {
    const direct = vi.fn();
    const invalidateCache = vi.fn();
    const link: ILink = {
      text: "https://example.com/carol",
      range: { start: { x: 0, y: 0 }, end: { x: 24, y: 0 } },
      activate: direct,
    };
    const provider: ILinkProvider = {
      provideLinks: (_y, callback) => callback([link]),
    };
    const empty: ILinkProvider = { provideLinks: (_y, callback) => callback(undefined) };
    const terminal = { linkDetector: { providers: [provider, empty], invalidateCache } };
    const activated: string[] = [];

    const guarded = guardTerminalLinks(terminal, (href) => activated.push(href));
    const provided: Array<ILink[] | undefined> = [];
    for (const each of terminal.linkDetector.providers) {
      each.provideLinks(0, (links) => provided.push(links));
    }
    provided[0]?.[0]?.activate(new MouseEvent("click"));

    expect({
      guarded,
      direct: direct.mock.calls,
      activated,
      invalidated: invalidateCache.mock.calls.length,
      texts: provided.map((links) => links?.map((each) => each.text)),
    }).toStrictEqual({
      guarded: true,
      direct: [],
      activated: ["https://example.com/carol"],
      invalidated: 1,
      texts: [["https://example.com/carol"], undefined],
    });
  });

  it("reports when the terminal has no link detector to guard", () => {
    expect(guardTerminalLinks({}, () => {})).toBe(false);
  });
});
