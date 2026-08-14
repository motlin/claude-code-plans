// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
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
      shouldScrollToEnd={false}
    />,
  ).container;
}

interface DisclosureState {
  ariaExpanded: string | null;
  controlsBody: boolean;
  bodyClassName: string | null;
  bodyText: string | null;
}

/** The disclosure state a screen reader would read off `element`. */
function disclosureState(element: Element | null): DisclosureState {
  const controlled = element?.getAttribute("aria-controls") ?? "";
  const body = controlled === "" ? null : document.getElementById(controlled);
  return {
    ariaExpanded: element?.getAttribute("aria-expanded") ?? null,
    controlsBody: body !== null,
    bodyClassName: body?.className ?? null,
    bodyText: body?.textContent ?? null,
  };
}

describe("SessionChat disclosure accessibility", () => {
  it("mounts a single tool row body only while its disclosure is expanded", async () => {
    const container = renderTranscript(toolCallRecords(1));
    const control = container.querySelector('[role="button"]');
    const collapsed = disclosureState(control);

    fireEvent.click(control as Element);

    await waitFor(() => {
      expect(disclosureState(control)).toStrictEqual({
        ariaExpanded: "true",
        controlsBody: true,
        bodyClassName: "flow-root",
        bodyText: "pattern: pattern-t11 match",
      });
    });

    const expanded = disclosureState(control);
    fireEvent.click(control as Element);

    expect({ collapsed, expanded, collapsedAgain: disclosureState(control) }).toStrictEqual({
      collapsed: {
        ariaExpanded: "false",
        controlsBody: false,
        bodyClassName: null,
        bodyText: null,
      },
      expanded: {
        ariaExpanded: "true",
        controlsBody: true,
        bodyClassName: "flow-root",
        bodyText: "pattern: pattern-t11 match",
      },
      collapsedAgain: {
        ariaExpanded: "false",
        controlsBody: false,
        bodyClassName: null,
        bodyText: null,
      },
    });
  });

  it("exposes aria-expanded and aria-controls on the grouped tool summary button, toggling on click", () => {
    const container = renderTranscript(toolCallRecords(2));
    const control = container.querySelector("button");
    const collapsed = disclosureState(control);

    fireEvent.click(control as Element);

    expect({ collapsed, expanded: disclosureState(control) }).toStrictEqual({
      collapsed: {
        ariaExpanded: "false",
        controlsBody: false,
        bodyClassName: null,
        bodyText: null,
      },
      expanded: {
        ariaExpanded: "true",
        controlsBody: true,
        bodyClassName: "flow-root",
        bodyText: "Searchedpattern-t1Searchedpattern-t2",
      },
    });
  });
});
