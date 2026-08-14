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

function renderRecords(records: unknown[], showCompactSummaries: boolean): HTMLElement {
  const { lines, toolResultMap } = processTranscript(records);
  return render(
    <SessionChat
      sessionId="test-session"
      lines={lines}
      toolResultMap={toolResultMap}
      showCompactSummaries={showCompactSummaries}
      showTranscriptOnly={true}
      shouldScrollToEnd={false}
    />,
  ).container;
}

/** The class list of the message column that wraps a user bubble and its footer. */
function userColumnClassName(container: HTMLElement): string | null {
  const column = Array.from(container.querySelectorAll("div")).find((element) =>
    element.className.startsWith("flex flex-col items-"),
  );
  return column?.className ?? null;
}

/** The class list of the action row holding the given copy button. */
function actionRowClassName(container: HTMLElement, title: string): string | null {
  const button = container.querySelector(`button[title="${title}"], button[aria-label="${title}"]`);
  return button?.parentElement?.parentElement?.className ?? null;
}

function actionButtonLabels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("button"))
    .filter((button) => /^Copy (message|link)$/.test(button.title || button.ariaLabel || ""))
    .map((button) => button.textContent ?? "");
}

const USER_TEXT = {
  type: "user",
  uuid: "user-1",
  message: { role: "user", content: "Fabricated user message" },
};

const ASSISTANT_TEXT = {
  type: "assistant",
  uuid: "assistant-1",
  message: {
    role: "assistant",
    content: [{ type: "text", text: "Fabricated assistant response" }],
  },
};

const SLASH_COMMAND_BODY = {
  type: "user",
  uuid: "user-meta-1",
  isMeta: true,
  message: { role: "user", content: "Fabricated slash command body" },
};

const COMMAND_INVOCATION = {
  type: "user",
  uuid: "user-command-1",
  message: {
    role: "user",
    content: "<command-name>/fabricated</command-name><command-args>--dry-run</command-args>",
  },
};

const COMPACT_SUMMARY = {
  type: "user",
  uuid: "user-compact-1",
  isCompactSummary: true,
  message: { role: "user", content: "Fabricated compact summary" },
};

describe("SessionChat assistant action row", () => {
  it("centres the assistant footer under the turn instead of pulling it up over the content", () => {
    const container = renderRecords([ASSISTANT_TEXT], true);

    expect(actionRowClassName(container, "Copy message")).toBe(
      "flex items-center gap-g2 pt-[4px] opacity-0 pointer-events-none group-hover/msg:opacity-100 group-hover/msg:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto transition-opacity duration-150",
    );
  });
});

describe("SessionChat user action row", () => {
  it("hangs the user footer off the column end with upstream's icon-only chrome", () => {
    const container = renderRecords([USER_TEXT], true);

    expect({
      column: userColumnClassName(container),
      actionRow: actionRowClassName(container, "Copy message"),
      buttonLabels: actionButtonLabels(container),
    }).toStrictEqual({
      column: "flex flex-col items-end gap-g6 max-w-[75%] min-w-0",
      actionRow:
        "flex items-center gap-g2 pt-[4px] -mt-[8px] text-[11px] text-t6 opacity-0 group-hover/msg:opacity-100 transition-opacity duration-150",
      buttonLabels: ["", ""],
    });
  });

  it("uses the same end-aligned column for every user-side entry variant", () => {
    const compactContainer = renderRecords([COMPACT_SUMMARY], false);
    fireEvent.click(compactContainer.querySelector("button")!);

    expect({
      slashCommandBody: userColumnClassName(renderRecords([SLASH_COMMAND_BODY], true)),
      command: userColumnClassName(renderRecords([COMMAND_INVOCATION], true)),
      compactSummary: userColumnClassName(compactContainer),
    }).toStrictEqual({
      slashCommandBody: "flex flex-col items-end gap-g6 max-w-[85%] min-w-0",
      command: "flex flex-col items-end gap-g6 max-w-[75%] min-w-0",
      compactSummary: "flex flex-col items-end gap-g6 max-w-[85%] min-w-0",
    });
  });
});
