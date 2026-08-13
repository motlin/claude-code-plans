// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useMessageAnchorDeepLink } from "../src/hooks/use-message-anchor-deep-link";
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

function renderDeepLink(hash: string, windowStartIndex: number) {
  return renderHook(
    ({ startIndex }: { startIndex: number }) =>
      useMessageAnchorDeepLink("session-1", startIndex, hash),
    { wrapper, initialProps: { startIndex: windowStartIndex } },
  );
}

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

describe("useMessageAnchorDeepLink", () => {
  it("scrolls straight to an anchor that is already inside the window", () => {
    renderDeepLink("#msg-1700", 1_500);

    expect({
      jumps: vi.mocked(jumpToMessage).mock.calls,
      fetches: vi.mocked(fetchEarlierTranscript).mock.calls.length,
    }).toStrictEqual({ jumps: [[1_700]], fetches: 0 });
  });

  it("pages history back for an anchor older than the window, then scrolls to it", () => {
    const { rerender } = renderDeepLink("#msg-1200", 1_500);

    const afterFirstRender = {
      jumps: vi.mocked(jumpToMessage).mock.calls.length,
      fetches: vi.mocked(fetchEarlierTranscript).mock.calls.length,
    };

    rerender({ startIndex: 1_100 });

    expect({
      afterFirstRender,
      jumps: vi.mocked(jumpToMessage).mock.calls,
      fetches: vi.mocked(fetchEarlierTranscript).mock.calls.length,
    }).toStrictEqual({
      afterFirstRender: { jumps: 0, fetches: 1 },
      jumps: [[1_200]],
      fetches: 1,
    });
  });

  it("stops asking for history once the window covers the whole file", () => {
    renderDeepLink("#msg-1200", 0);

    expect({
      jumps: vi.mocked(jumpToMessage).mock.calls,
      fetches: vi.mocked(fetchEarlierTranscript).mock.calls.length,
    }).toStrictEqual({ jumps: [[1_200]], fetches: 0 });
  });

  it("jumps once, so paging further back does not yank the reader off what they scrolled to", () => {
    const { rerender } = renderDeepLink("#msg-1700", 1_500);

    rerender({ startIndex: 1_100 });
    rerender({ startIndex: 700 });

    expect(vi.mocked(jumpToMessage).mock.calls).toStrictEqual([[1_700]]);
  });

  it("leaves a hash that is not a message anchor alone", () => {
    renderDeepLink("#files", 1_500);

    expect({
      jumps: vi.mocked(jumpToMessage).mock.calls.length,
      fetches: vi.mocked(fetchEarlierTranscript).mock.calls.length,
    }).toStrictEqual({ jumps: 0, fetches: 0 });
  });
});
