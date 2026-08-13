// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { SessionChat } from "../src/components/session-chat";
import { processTranscript } from "../src/lib/transcript";

let showDebug = false;

vi.mock("../src/components/settings-provider", () => ({
  useSettings: () => ({ settings: { showDebug } }),
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

const THINKING = "Fabricated reasoning about the next step";

function renderThinking(options: { showDebug?: boolean } = {}): HTMLElement {
  showDebug = options.showDebug ?? false;
  const { lines, toolResultMap } = processTranscript([
    {
      type: "assistant",
      uuid: "a1",
      message: {
        role: "assistant",
        content: [{ type: "thinking", thinking: THINKING }],
      },
    },
  ]);
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

describe("thinking block", () => {
  it("renders the thinking text inline as italic upstream body type", () => {
    renderThinking();

    expect(screen.getByText(THINKING).className).toBe(
      "text-body text-t6 italic whitespace-pre-wrap break-words pr-6",
    );
  });

  it("wraps the thinking text in a hover group with no collapsed card chrome", () => {
    renderThinking();

    const wrapper = screen.getByText(THINKING).parentElement;

    expect(wrapper?.className).toBe("group/body relative");
  });

  it("shows the thinking text without a disclosure toggle", () => {
    const container = renderThinking();

    expect({
      expandables: container.querySelectorAll("[aria-expanded]").length,
      thinkingLabels: screen.queryAllByText("Thinking...").length,
    }).toStrictEqual({ expandables: 0, thinkingLabels: 0 });
  });

  it("widens the reserved gutter when the debug link shares the overlay", () => {
    const container = renderThinking({ showDebug: true });

    expect({
      className: screen.getByText(THINKING).className,
      debugLinks: container.querySelectorAll('a[href^="/session/test-session/source/"]').length,
    }).toStrictEqual({
      className: "text-body text-t6 italic whitespace-pre-wrap break-words pr-10",
      debugLinks: 1,
    });
  });

  it("offers a copy button for the thinking text", () => {
    renderThinking();

    expect(screen.getByLabelText("Copy").tagName).toBe("BUTTON");
  });
});
