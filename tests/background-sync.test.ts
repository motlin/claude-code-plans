import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { runBackgroundSync } from "../src/hooks/use-session-viewed-state";

describe("runBackgroundSync", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("swallows a rejected background call instead of leaving an unhandled rejection", async () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const rejections: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      rejections.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    const failure = new TypeError("Failed to fetch");
    const returned = runBackgroundSync("visibility-update", () => Promise.reject(failure));

    // Give the microtask queue and the rejection check a full turn to settle.
    await new Promise((resolve) => setTimeout(resolve, 10));
    process.off("unhandledRejection", onUnhandled);

    expect({
      returned,
      rejections,
      debugCalls: debugSpy.mock.calls.map((call) => [call[0], call[1]]),
    }).toStrictEqual({
      returned: undefined,
      rejections: [],
      debugCalls: [["[session-viewed-state] background visibility-update failed", failure]],
    });
  });

  it("swallows a synchronous throw from the background call", async () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const failure = new Error("boom");

    expect(
      runBackgroundSync("mark-reviewed", () => {
        throw failure;
      }),
    ).toBe(undefined);

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(debugSpy.mock.calls.map((call) => [call[0], call[1]])).toStrictEqual([
      ["[session-viewed-state] background mark-reviewed failed", failure],
    ]);
  });

  it("stays silent when the background call succeeds", async () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

    runBackgroundSync("visibility-update", () => Promise.resolve());
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(debugSpy.mock.calls).toStrictEqual([]);
  });
});
