// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  createRetryableSync,
  createVisibilityDwellController,
  useSessionViewedState,
} from "../src/hooks/use-session-viewed-state";
import {
  __testing as visibilityTesting,
  isSessionVisible,
  setSessionVisibility,
} from "../src/lib/session-visibility";

vi.mock("../src/lib/hmr-persist", () => ({
  hmrPersist: (_key: string, initialize: () => unknown) => initialize(),
}));

describe("session viewed visibility dwell", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(async () => {
    cleanup();
    await Promise.resolve();
    visibilityTesting.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("requires 1.5 seconds of continuous visibility and cancels interrupted dwell", async () => {
    const visibilityChanges: boolean[] = [];
    const dwellTimes: number[] = [];
    const controller = createVisibilityDwellController({
      cancel: clearTimeout,
      onDwell: () => dwellTimes.push(Date.now()),
      onVisibilityChange: (visible) => visibilityChanges.push(visible),
      schedule: setTimeout,
    });

    controller.setVisible(true);
    await vi.advanceTimersByTimeAsync(1_499);
    controller.setVisible(false);
    await vi.advanceTimersByTimeAsync(1);
    controller.setVisible(true);
    await vi.advanceTimersByTimeAsync(1_500);
    controller.stop();

    expect({ visibilityChanges, dwellTimes }).toStrictEqual({
      visibilityChanges: [true, false, true, false],
      dwellTimes: [3_000],
    });
  });

  it("expires server visibility leases when a browser stops heartbeating", () => {
    setSessionVisibility("client-test-100", "session-test-100", true, 1_000);

    expect({
      beforeExpiry: isSessionVisible("session-test-100", 30_999),
      atExpiry: isSessionVisible("session-test-100", 31_000),
      unrelatedSession: isSessionVisible("session-test-200", 31_000),
    }).toStrictEqual({ beforeExpiry: true, atExpiry: false, unrelatedSession: false });
  });

  it("retries a failed dwell auto-mark on the visibility heartbeat", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(Math, "random").mockReturnValue(0);
    const requests: Array<{ body: unknown; path: string }> = [];
    let viewedAttempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        requests.push({
          body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
          path,
        });
        if (path.endsWith("/viewed")) {
          viewedAttempts += 1;
          if (viewedAttempts === 1) {
            return new Response("{}", {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }
          return Response.json({
            currentMessageIndex: 100,
            lastViewedMessageIndex: 100,
            reviewTargetMessageIndex: 100,
            newMessageCount: 0,
            viewedInCcp: true,
            viewedInHerdr: false,
            viewedAnywhere: true,
          });
        }
        return new Response(null, { status: 204 });
      }),
    );

    let intersectionCallback: IntersectionObserverCallback = () => {
      throw new Error("Intersection observer callback was not installed");
    };
    class TestIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) {
        intersectionCallback = callback;
      }

      disconnect(): void {}
      observe(): void {}
    }
    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(QueryClientProvider, { client }, children);
    const { result } = renderHook(() => useSessionViewedState("session-test-100", 100), {
      wrapper,
    });

    await act(async () => {
      result.current.visibilityRef(document.createElement("div"));
    });
    await act(async () => {
      intersectionCallback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(requests).toStrictEqual([
      {
        body: { clientId: "0-0", visible: true },
        path: "/api/sessions/session-test-100/visibility",
      },
      {
        body: { action: "reviewed", messageIndex: 100 },
        path: "/api/sessions/session-test-100/viewed",
      },
      {
        body: { clientId: "0-0", visible: true },
        path: "/api/sessions/session-test-100/visibility",
      },
      {
        body: { action: "reviewed", messageIndex: 100 },
        path: "/api/sessions/session-test-100/viewed",
      },
    ]);
  });
});

describe("retryable session viewed sync", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not retry after a successful attempt", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const operations: string[] = [];
    const sync = createRetryableSync(() => {
      operations.push("call");
      return Promise.resolve();
    });

    sync.attempt("mark-reviewed");
    await new Promise((resolve) => setTimeout(resolve, 10));
    sync.retryIfFailed("mark-reviewed-retry");
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(operations).toStrictEqual(["call"]);
  });

  it("retries after a failed attempt", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const operations: string[] = [];
    const failure = new Error("mark reviewed failed");
    const sync = createRetryableSync(() => {
      operations.push("call");
      return operations.length === 1 ? Promise.reject(failure) : Promise.resolve();
    });

    sync.attempt("mark-reviewed");
    await new Promise((resolve) => setTimeout(resolve, 10));
    sync.retryIfFailed("mark-reviewed-retry");
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(operations).toStrictEqual(["call", "call"]);
  });

  it("stops retrying after a retry succeeds", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const operations: string[] = [];
    const failure = new Error("mark reviewed failed");
    const sync = createRetryableSync(() => {
      operations.push("call");
      return operations.length === 1 ? Promise.reject(failure) : Promise.resolve();
    });

    sync.attempt("mark-reviewed");
    await new Promise((resolve) => setTimeout(resolve, 10));
    sync.retryIfFailed("mark-reviewed-retry");
    await new Promise((resolve) => setTimeout(resolve, 10));
    sync.retryIfFailed("mark-reviewed-retry");
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(operations).toStrictEqual(["call", "call"]);
  });
});
