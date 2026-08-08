// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ClaudeEventsProvider } from "../src/hooks/use-claude-events";
import { DOMAIN_EVENTS, HERDR_EVENTS } from "../src/lib/hook-events";

class TestEventSource extends EventTarget {
  static current: TestEventSource | null = null;

  readonly close = vi.fn();
  onerror: ((event: Event) => void) | null = null;

  constructor(readonly url: string | URL) {
    super();
    TestEventSource.current = this;
  }

  emit(type: string, data: Record<string, unknown> = {}): void {
    this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data) }));
  }
}

function renderProvider(): { client: QueryClient; eventSource: TestEventSource } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["terminal", "placements"], []);
  client.setQueryData(["tmux", "windows"], []);
  client.setQueryData(["herdr", "panes"], []);

  render(
    <QueryClientProvider client={client}>
      <ClaudeEventsProvider>
        <div />
      </ClaudeEventsProvider>
    </QueryClientProvider>,
  );

  const eventSource = TestEventSource.current;
  if (eventSource === null) throw new Error("Expected ClaudeEventsProvider to open EventSource");
  return { client, eventSource };
}

function invalidationState(client: QueryClient) {
  return {
    herdrPanes: client.getQueryState(["herdr", "panes"])?.isInvalidated,
    terminalPlacements: client.getQueryState(["terminal", "placements"])?.isInvalidated,
    tmuxWindows: client.getQueryState(["tmux", "windows"])?.isInvalidated,
  };
}

describe("ClaudeEventsProvider terminal placement invalidation", () => {
  beforeEach(() => {
    TestEventSource.current = null;
    vi.stubGlobal("EventSource", TestEventSource);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("invalidates terminal placements and the legacy tmux query when a prompt is submitted", () => {
    const { client, eventSource } = renderProvider();

    act(() => {
      eventSource.emit(DOMAIN_EVENTS.SESSION_PROMPT_SUBMITTED, {
        sessionId: "session-test-100",
      });
    });

    expect(invalidationState(client)).toStrictEqual({
      herdrPanes: false,
      terminalPlacements: true,
      tmuxWindows: true,
    });
  });

  it("invalidates terminal placements and the legacy tmux query on session lifecycle events", () => {
    const { client, eventSource } = renderProvider();

    act(() => {
      eventSource.emit(DOMAIN_EVENTS.SESSION_STARTED, {
        sessionId: "session-test-100",
      });
    });

    expect(invalidationState(client)).toStrictEqual({
      herdrPanes: false,
      terminalPlacements: true,
      tmuxWindows: true,
    });
  });

  it("invalidates terminal placements and the legacy Herdr panes query on Herdr events", () => {
    const { client, eventSource } = renderProvider();

    act(() => {
      eventSource.emit(HERDR_EVENTS.PANE_CREATED);
    });

    expect(invalidationState(client)).toStrictEqual({
      herdrPanes: true,
      terminalPlacements: true,
      tmuxWindows: false,
    });
  });
});
