// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
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

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): ResizeObserverEntry[] {
    return [];
  }
}

globalThis.ResizeObserver = NoopResizeObserver;

afterEach(cleanup);

const SESSION_ID = "session-alice-100";

const AGENT_NAME = { type: "agent-name", agentName: "Alice", sessionId: SESSION_ID };
const AGENT_COLOR = { type: "agent-color", agentColor: "blue", sessionId: SESSION_ID };
const PERMISSION_MODE = {
  type: "permission-mode",
  permissionMode: "acceptEdits",
  sessionId: SESSION_ID,
};
const WORKTREE_STATE = {
  type: "worktree-state",
  sessionId: SESSION_ID,
  worktreeSession: {
    originalCwd: "/tmp/test/alice-project",
    worktreePath: "/tmp/test/alice-worktree",
    worktreeName: "alice-worktree",
    worktreeBranch: "test/alice-worktree",
    sessionId: SESSION_ID,
  },
};
const USER_TEXT = {
  type: "user",
  uuid: "user-1",
  message: { role: "user", content: "Fabricated user message" },
};

function renderRecords(records: unknown[]): HTMLElement {
  const { lines, toolResultMap } = processTranscript(records);
  return render(
    <SessionChat
      sessionId={SESSION_ID}
      lines={lines}
      toolResultMap={toolResultMap}
      showSystemBanners
      shouldScrollToEnd={false}
    />,
  ).container;
}

/** The single "Initialized session" disclosure control, or null when absent. */
function initButton(container: HTMLElement): HTMLButtonElement | null {
  const buttons = Array.from(container.querySelectorAll("button")).filter((button) =>
    button.textContent?.includes("Initialized session"),
  );
  if (buttons.length > 1) throw new Error(`Expected one init row, found ${buttons.length}`);
  return buttons[0] ?? null;
}

/** The label span, chevron presence, aria state, and mounted body text of the init row. */
function initRow(container: HTMLElement) {
  const button = initButton(container);
  if (!button) return null;
  const bodyId = button.getAttribute("aria-controls");
  const body = bodyId === null ? null : container.querySelector(`#${CSS.escape(bodyId)}`);
  return {
    labelClassName: button.querySelector("span")?.className ?? null,
    ariaExpanded: button.getAttribute("aria-expanded"),
    hasChevron: button.querySelector("svg") !== null,
    bodyText: body?.textContent ?? null,
  };
}

describe("session init disclosure", () => {
  it("folds leading session metadata into one collapsed disclosure row without mounting its body", () => {
    const container = renderRecords([
      AGENT_NAME,
      AGENT_COLOR,
      PERMISSION_MODE,
      WORKTREE_STATE,
      USER_TEXT,
    ]);

    const row = initRow(container);
    expect({
      labelClassName: row?.labelClassName,
      ariaExpanded: row?.ariaExpanded,
      hasChevron: row?.hasChevron,
      bodyText: row?.bodyText,
    }).toStrictEqual({
      labelClassName: "text-body min-w-0 truncate text-assistant-primary",
      ariaExpanded: "false",
      hasChevron: true,
      bodyText: null,
    });
  });

  it("expands the folded metadata when the disclosure row is clicked", () => {
    const container = renderRecords([AGENT_NAME, USER_TEXT]);
    const button = initButton(container);
    if (!button) throw new Error("Expected an init disclosure row");

    const collapsed = initRow(container);
    fireEvent.click(button);

    expect({ collapsed, expanded: initRow(container) }).toStrictEqual({
      collapsed: {
        labelClassName: "text-body min-w-0 truncate text-assistant-primary",
        ariaExpanded: "false",
        hasChevron: true,
        bodyText: null,
      },
      expanded: {
        labelClassName: "text-body min-w-0 truncate text-assistant-primary",
        ariaExpanded: "true",
        hasChevron: true,
        bodyText: "Alice",
      },
    });
  });

  it("leaves metadata that follows a message unfolded", () => {
    const container = renderRecords([USER_TEXT, WORKTREE_STATE]);

    expect({
      initRow: initButton(container),
      showsWorktree: container.textContent?.includes("Worktree: alice-worktree"),
    }).toStrictEqual({ initRow: null, showsWorktree: true });
  });

  it("renders no disclosure row for a transcript without session metadata", () => {
    expect(initButton(renderRecords([USER_TEXT]))).toStrictEqual(null);
  });

  it("renders no disclosure row when system banners are hidden", () => {
    const { lines, toolResultMap } = processTranscript([AGENT_NAME, USER_TEXT]);
    const container = render(
      <SessionChat
        sessionId={SESSION_ID}
        lines={lines}
        toolResultMap={toolResultMap}
        shouldScrollToEnd={false}
      />,
    ).container;

    expect(initButton(container)).toStrictEqual(null);
  });
});
