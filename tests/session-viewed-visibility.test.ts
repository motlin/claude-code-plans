import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  createRetryableSync,
  createVisibilityDwellController,
} from "../src/hooks/use-session-viewed-state";
import {
  __testing as visibilityTesting,
  isSessionVisible,
  setSessionVisibility,
} from "../src/lib/session-visibility";

describe("session viewed visibility dwell", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    visibilityTesting.clear();
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
