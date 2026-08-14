// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { usePendingMessageJump } from "../src/hooks/use-pending-message-jump";
import { fetchEarlierTranscript } from "../src/lib/api/sessions";
import { jumpToMessage } from "../src/lib/jump-to-message";

vi.mock("../src/lib/api/sessions", () => ({
  fetchEarlierTranscript: vi.fn(() => Promise.resolve()),
}));
vi.mock("../src/lib/jump-to-message", () => ({
  jumpToMessage: vi.fn(() => true),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

interface WindowProps {
  startIndex: number;
  uuidToLine: ReadonlyMap<string, number>;
}

function renderPendingJump(initialProps: WindowProps) {
  return renderHook(
    ({ startIndex, uuidToLine }: WindowProps) =>
      usePendingMessageJump("session-1", startIndex, uuidToLine),
    { wrapper, initialProps },
  );
}

const HELD = new Map([["u-1700", 1_700]]);
const NOT_HELD = new Map<string, number>();

beforeEach(() => {
  vi.mocked(fetchEarlierTranscript).mockClear();
  vi.mocked(jumpToMessage).mockClear();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("usePendingMessageJump", () => {
  it("scrolls straight to a message the loaded records already hold", () => {
    const { result } = renderPendingJump({ startIndex: 1_500, uuidToLine: HELD });

    act(() => result.current("u-1700"));

    expect({
      jumps: vi.mocked(jumpToMessage).mock.calls,
      fetches: vi.mocked(fetchEarlierTranscript).mock.calls.length,
    }).toStrictEqual({ jumps: [[1_700]], fetches: 0 });
  });

  it("pages history back for a message the loaded records do not hold, then scrolls to it", () => {
    const { result, rerender } = renderPendingJump({
      startIndex: 1_500,
      uuidToLine: NOT_HELD,
    });

    act(() => result.current("u-1700"));
    const afterRequest = {
      jumps: vi.mocked(jumpToMessage).mock.calls.length,
      fetches: vi.mocked(fetchEarlierTranscript).mock.calls.length,
    };

    rerender({ startIndex: 1_100, uuidToLine: HELD });

    expect({
      afterRequest,
      jumps: vi.mocked(jumpToMessage).mock.calls,
      fetches: vi.mocked(fetchEarlierTranscript).mock.calls.length,
    }).toStrictEqual({
      afterRequest: { jumps: 0, fetches: 1 },
      jumps: [[1_700]],
      fetches: 1,
    });
  });

  it("asks for one page at a time while a request is still in flight", () => {
    const { result, rerender } = renderPendingJump({
      startIndex: 1_500,
      uuidToLine: NOT_HELD,
    });

    act(() => result.current("u-1700"));
    rerender({ startIndex: 1_500, uuidToLine: new Map() });

    expect(vi.mocked(fetchEarlierTranscript).mock.calls.length).toBe(1);
  });

  it("stops asking for history once the window covers the whole file", () => {
    const { result } = renderPendingJump({ startIndex: 0, uuidToLine: NOT_HELD });

    act(() => result.current("u-1700"));

    expect({
      jumps: vi.mocked(jumpToMessage).mock.calls.length,
      fetches: vi.mocked(fetchEarlierTranscript).mock.calls.length,
    }).toStrictEqual({ jumps: 0, fetches: 0 });
  });

  it("jumps once, so paging further back does not yank the reader off what they scrolled to", () => {
    const { result, rerender } = renderPendingJump({ startIndex: 1_500, uuidToLine: HELD });

    act(() => result.current("u-1700"));
    rerender({ startIndex: 1_100, uuidToLine: new Map(HELD) });
    rerender({ startIndex: 700, uuidToLine: new Map(HELD) });

    expect(vi.mocked(jumpToMessage).mock.calls).toStrictEqual([[1_700]]);
  });

  it("does nothing at all until a chip asks for a message", () => {
    const { rerender } = renderPendingJump({ startIndex: 1_500, uuidToLine: NOT_HELD });

    rerender({ startIndex: 1_100, uuidToLine: HELD });

    expect({
      jumps: vi.mocked(jumpToMessage).mock.calls.length,
      fetches: vi.mocked(fetchEarlierTranscript).mock.calls.length,
    }).toStrictEqual({ jumps: 0, fetches: 0 });
  });
});
