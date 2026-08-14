// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { SessionChat } from "../src/components/session-chat";
import { jumpToMessage } from "../src/lib/jump-to-message";
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
  readonly observedElements = new Set<Element>();

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }

  observe(element: Element) {
    this.observedElements.add(element);
  }
  unobserve(element: Element) {
    this.observedElements.delete(element);
  }
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

function observerFor(element: Element): FakeResizeObserver {
  const observer = FakeResizeObserver.instances.find((candidate) =>
    candidate.observedElements.has(element),
  );
  if (!observer) throw new Error("No resize observer watches the session chat container.");
  return observer;
}

function followObserverCount(): number {
  return FakeResizeObserver.instances.filter((observer) =>
    [...observer.observedElements].some((element) =>
      element.querySelector("[data-testid='virtualized-transcript']"),
    ),
  ).length;
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
  it("mounts a viewport-sized turn window and reveals an unmounted jump target", () => {
    const view = render(
      <SessionChat
        sessionId="session-100"
        shouldScrollToEnd={false}
        lines={messages(100)}
        toolResultMap={new Map()}
      />,
    );
    const spacers = [...view.container.querySelectorAll<HTMLElement>("[data-transcript-spacer]")];
    const initialState = {
      mountedTurns: view.container.querySelectorAll(".group\\/msg").length,
      spacerHeights: spacers.map((spacer) => spacer.style.height),
    };

    let jumpRequested = true;
    act(() => {
      jumpRequested = jumpToMessage({ uuid: "message-90", recordIndex: 90 });
    });

    expect({
      initialState,
      mountedJumpWindowTurns: view.container.querySelectorAll(".group\\/msg").length,
      jumpRequested,
      spacerHeights: spacers.map((spacer) => spacer.style.height),
    }).toStrictEqual({
      initialState: { mountedTurns: 5, spacerHeights: ["0px", "14400px"] },
      mountedJumpWindowTurns: 3,
      jumpRequested: false,
      spacerHeights: ["14080px", "960px"],
    });

    act(flushAnimationFrames);

    expect(scrollIntoView.mock.calls).toStrictEqual([[{ block: "center", behavior: "smooth" }]]);
  });

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
    act(() => observerFor(view.container.firstElementChild!).resize());
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
    act(() => observerFor(view.container.firstElementChild!).resize());
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
      followObservers: followObserverCount(),
      scrollIntoViewCalls: scrollIntoView.mock.calls,
      scrollToCalls: scrollTo.mock.calls,
    }).toStrictEqual({
      followObservers: 0,
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
      followObservers: followObserverCount(),
      scrollIntoViewCalls: scrollIntoView.mock.calls,
    }).toStrictEqual({
      followObservers: 2,
      scrollIntoViewCalls: [[{ block: "end" }], [{ block: "end" }]],
    });
  });
});
