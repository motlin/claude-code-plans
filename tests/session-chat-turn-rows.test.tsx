// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
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

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
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

function recordIndices(container: HTMLElement): (string | null)[] {
  return Array.from(container.querySelectorAll("[data-record-index]")).map((element) =>
    element.getAttribute("data-record-index"),
  );
}

describe("SessionChat turn rows", () => {
  it("carries each turn's session-absolute record index, so a jump lands on the right row whichever window is loaded", () => {
    const wholeFile = recordIndices(renderWindow(RECORDS, 0));
    cleanup();

    expect({
      wholeFile,
      tailWindow: recordIndices(renderWindow(RECORDS.slice(2), 2)),
    }).toStrictEqual({ wholeFile: ["0", "1", "2", "3"], tailWindow: ["2", "3"] });
  });

  it("gives no turn a URL of its own, matching upstream claude.ai/code, which addresses a session and nothing finer", () => {
    const container = renderWindow(RECORDS, 0);

    expect({
      messageAnchors: container.querySelectorAll("[id^='msg-']").length,
      copyLinkButtons: container.querySelectorAll("button[aria-label='Copy link']").length,
      copyMessageButtons: container.querySelectorAll("button[aria-label='Copy message']").length,
    }).toStrictEqual({ messageAnchors: 0, copyLinkButtons: 0, copyMessageButtons: 4 });
  });
});
