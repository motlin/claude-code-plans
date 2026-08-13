// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { SessionChat } from "../src/components/session-chat";
import { processTranscript } from "../src/lib/transcript";

vi.mock("../src/components/settings-provider", () => ({
  useSettings: () => ({ settings: { showDebug: false } }),
}));
vi.mock("../src/lib/hmr-persist", () => ({
  hmrPersist: <T,>(_key: string, initialize: () => T): T => initialize(),
}));
vi.mock("../src/hooks/use-claude-events", () => ({
  useClaudeEvents: () => ({ failedTools: new Map() }),
}));

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

let clipboardWrites: string[] = [];

beforeEach(() => {
  clipboardWrites = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    writable: true,
    value: {
      writeText: (text: string) => {
        clipboardWrites.push(text);
        return Promise.resolve();
      },
    },
  });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

/**
 * A four-record session. The transcript endpoint serves only the tail of a long
 * session's JSONL, so the same records are rendered both as the whole file and
 * as a window that starts partway in.
 */
const RECORDS = [
  { type: "user", uuid: "u-1", message: { role: "user", content: "Fabricated first question" } },
  {
    type: "assistant",
    uuid: "a-1",
    message: { role: "assistant", content: [{ type: "text", text: "Fabricated first answer" }] },
  },
  { type: "user", uuid: "u-2", message: { role: "user", content: "Fabricated second question" } },
  {
    type: "assistant",
    uuid: "a-2",
    message: { role: "assistant", content: [{ type: "text", text: "Fabricated second answer" }] },
  },
];

function renderWindow(records: unknown[], recordStartIndex: number): HTMLElement {
  const { lines, toolResultMap } = processTranscript(records, recordStartIndex);
  return render(
    <SessionChat
      sessionId="test-session"
      lines={lines}
      toolResultMap={toolResultMap}
      showTranscriptOnly={true}
      shouldScrollToEnd={false}
    />,
  ).container;
}

function anchorIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("[id^='msg-']")).map((element) => element.id);
}

/** Copy the link of the turn whose rendered text contains `text`. */
function copyLinkOf(container: HTMLElement, text: string): string {
  const turn = Array.from(container.querySelectorAll("[id^='msg-']")).find((element) =>
    element.textContent?.includes(text),
  );
  if (!turn) throw new Error(`No turn rendering ${JSON.stringify(text)}.`);
  const button = turn.querySelector("button[aria-label='Copy link']");
  if (!button)
    throw new Error(`No copy-link button on the turn rendering ${JSON.stringify(text)}.`);
  fireEvent.click(button);
  const written = clipboardWrites.at(-1);
  if (written === undefined)
    throw new Error("The copy-link button wrote nothing to the clipboard.");
  return written;
}

describe("SessionChat message anchors", () => {
  it("anchors on the session-absolute record index, not the window position", () => {
    const wholeFile = renderWindow(RECORDS, 0);
    const wholeFileIds = anchorIds(wholeFile);
    cleanup();
    const tailWindow = renderWindow(RECORDS.slice(2), 2);

    expect({ wholeFileIds, tailWindowIds: anchorIds(tailWindow) }).toStrictEqual({
      wholeFileIds: ["msg-0", "msg-1", "msg-2", "msg-3"],
      tailWindowIds: ["msg-2", "msg-3"],
    });
  });

  it("copies the same link for a message whether or not the window has moved past it", () => {
    const wholeFile = renderWindow(RECORDS, 0);
    const wholeFileLink = copyLinkOf(wholeFile, "Fabricated second answer");
    cleanup();
    const tailWindow = renderWindow(RECORDS.slice(2), 2);

    expect({
      wholeFileLink,
      tailWindowLink: copyLinkOf(tailWindow, "Fabricated second answer"),
    }).toStrictEqual({
      wholeFileLink: "http://localhost:3000/#msg-3",
      tailWindowLink: "http://localhost:3000/#msg-3",
    });
  });

  it("keeps the copied link pointing at the element the anchor scrolls to", () => {
    const container = renderWindow(RECORDS.slice(2), 2);
    const link = copyLinkOf(container, "Fabricated second answer");
    const anchor = link.slice(link.indexOf("#") + 1);

    expect(container.querySelector(`#${anchor}`)?.textContent).toContain(
      "Fabricated second answer",
    );
  });
});
