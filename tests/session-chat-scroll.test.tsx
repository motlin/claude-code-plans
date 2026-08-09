// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { SessionChat } from "../src/components/session-chat";
import type { SessionLine } from "../src/lib/sessions";

vi.mock("../src/components/settings-provider", () => ({
  useSettings: () => ({ settings: { showDebug: false } }),
}));
vi.mock("../src/lib/hmr-persist", () => ({
  hmrPersist: <T,>(_key: string, initialize: () => T): T => initialize(),
}));
vi.mock("../src/hooks/use-claude-events", () => ({
  useClaudeEvents: () => ({ failedTools: new Map() }),
}));

const animationFrames: Array<FrameRequestCallback> = [];
const scrollIntoView = vi.fn();
const scrollTo = vi.fn();

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];

  readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }

  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }

  resize() {
    this.callback([], this);
  }
}

function messages(count: number): SessionLine[] {
  return Array.from({ length: count }, (_, index) => ({
    type: index % 2 === 0 ? "user" : "assistant",
    uuid: `message-${index}`,
    lineIndex: index,
    message: {
      role: index % 2 === 0 ? "user" : "assistant",
      content: `Fabricated message ${index}`,
    },
  }));
}

function flushAnimationFrames() {
  while (animationFrames.length > 0) {
    const pendingFrames = animationFrames.splice(0);
    for (const callback of pendingFrames) callback(0);
  }
}

beforeEach(() => {
  animationFrames.length = 0;
  FakeResizeObserver.instances = [];
  scrollIntoView.mockReset();
  scrollTo.mockReset();

  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    animationFrames.push(callback);
    return animationFrames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("scrollTo", scrollTo);
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView,
  });
  Object.defineProperty(document.documentElement, "scrollHeight", {
    configurable: true,
    value: 10_000,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 1_000,
  });
  Object.defineProperty(window, "scrollY", {
    configurable: true,
    value: 9_000,
    writable: true,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

describe("SessionChat initial scrolling", () => {
  it("scrolls a long session to its end once and does not follow an append after the user scrolls up", () => {
    const initialLines = messages(100);
    const view = render(
      <SessionChat
        sessionId="session-100"
        initialScrollKey="history-entry-100"
        lines={initialLines}
        toolResultMap={new Map()}
      />,
    );

    act(flushAnimationFrames);
    act(() => FakeResizeObserver.instances[0]!.resize());
    act(flushAnimationFrames);

    Object.defineProperty(window, "scrollY", { configurable: true, value: 100, writable: true });
    fireEvent.scroll(window);
    view.rerender(
      <SessionChat
        sessionId="session-100"
        initialScrollKey="history-entry-100"
        lines={messages(101)}
        toolResultMap={new Map()}
      />,
    );
    act(() => FakeResizeObserver.instances[0]!.resize());
    act(flushAnimationFrames);

    expect({
      scrollIntoViewCalls: scrollIntoView.mock.calls,
      scrollToCalls: scrollTo.mock.calls,
    }).toStrictEqual({
      scrollIntoViewCalls: [[{ block: "end" }]],
      scrollToCalls: [[{ top: 10_000 }]],
    });
  });

  it("leaves a restored session entry at its saved scroll position", () => {
    render(
      <SessionChat
        sessionId="session-200"
        initialScrollKey="history-entry-200"
        shouldScrollToEnd={false}
        lines={messages(100)}
        toolResultMap={new Map()}
      />,
    );

    act(flushAnimationFrames);

    expect({
      resizeObservers: FakeResizeObserver.instances.length,
      scrollIntoViewCalls: scrollIntoView.mock.calls,
      scrollToCalls: scrollTo.mock.calls,
    }).toStrictEqual({
      resizeObservers: 0,
      scrollIntoViewCalls: [],
      scrollToCalls: [],
    });
  });

  it("scrolls the same session again only when it has a fresh history entry", () => {
    const firstView = render(
      <SessionChat
        sessionId="session-300"
        initialScrollKey="history-entry-300"
        lines={messages(100)}
        toolResultMap={new Map()}
      />,
    );
    act(flushAnimationFrames);
    firstView.unmount();

    const restoredView = render(
      <SessionChat
        sessionId="session-300"
        initialScrollKey="history-entry-300"
        lines={messages(100)}
        toolResultMap={new Map()}
      />,
    );
    act(flushAnimationFrames);
    restoredView.unmount();

    render(
      <SessionChat
        sessionId="session-300"
        initialScrollKey="history-entry-301"
        lines={messages(100)}
        toolResultMap={new Map()}
      />,
    );
    act(flushAnimationFrames);

    expect({
      resizeObservers: FakeResizeObserver.instances.length,
      scrollIntoViewCalls: scrollIntoView.mock.calls,
    }).toStrictEqual({
      resizeObservers: 2,
      scrollIntoViewCalls: [[{ block: "end" }], [{ block: "end" }]],
    });
  });
});
