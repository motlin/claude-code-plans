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

/** `count` tool calls in one assistant turn, each with its own result. */
function toolCallRecords(count: number): unknown[] {
  const ids = Array.from({ length: count }, (_, index) => `t${index + 1}`);
  return [
    {
      type: "assistant",
      uuid: "a1",
      message: {
        role: "assistant",
        content: ids.map((id) => ({
          type: "tool_use",
          id,
          name: "Grep",
          input: { pattern: `pattern-${id}` },
        })),
      },
    },
    ...ids.map((id) => ({
      type: "user",
      uuid: `r-${id}`,
      parentUuid: "a1",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: id, content: "1 match" }],
      },
    })),
  ];
}

function renderTranscript(records: unknown[]): HTMLElement {
  const { lines, toolResultMap } = processTranscript(records);
  return render(
    <SessionChat
      sessionId="test-session"
      lines={lines}
      toolResultMap={toolResultMap}
      showCompactSummaries
      showTranscriptOnly
      showThinking
    />,
  ).container;
}

interface DisclosureState {
  ariaExpanded: string | null;
  controlsBody: boolean;
}

/** The disclosure state a screen reader would read off `element`. */
function disclosureState(element: Element | null): DisclosureState {
  const controlled = element?.getAttribute("aria-controls") ?? "";
  return {
    ariaExpanded: element?.getAttribute("aria-expanded") ?? null,
    controlsBody: controlled !== "" && document.getElementById(controlled) !== null,
  };
}

/** Clicks the disclosure control and reports its state on either side of the click. */
function statesAroundClick(element: Element | null): {
  collapsed: DisclosureState;
  expanded: DisclosureState;
} {
  const collapsed = disclosureState(element);
  fireEvent.click(element as Element);
  return { collapsed, expanded: disclosureState(element) };
}

const TOGGLES_AND_CONTROLS_ITS_BODY = {
  collapsed: { ariaExpanded: "false", controlsBody: true },
  expanded: { ariaExpanded: "true", controlsBody: true },
};

describe("SessionChat disclosure accessibility", () => {
  it("exposes aria-expanded and aria-controls on a single tool row, toggling on click", () => {
    const container = renderTranscript(toolCallRecords(1));

    expect(statesAroundClick(container.querySelector('[role="button"]'))).toStrictEqual(
      TOGGLES_AND_CONTROLS_ITS_BODY,
    );
  });

  it("exposes aria-expanded and aria-controls on the grouped tool summary button, toggling on click", () => {
    const container = renderTranscript(toolCallRecords(2));

    expect(statesAroundClick(container.querySelector("button"))).toStrictEqual(
      TOGGLES_AND_CONTROLS_ITS_BODY,
    );
  });
});
