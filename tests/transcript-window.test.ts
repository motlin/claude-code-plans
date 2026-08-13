import { describe, expect, it, vi, afterEach } from "vite-plus/test";
import { QueryClient } from "@tanstack/react-query";
import {
  fetchEarlierTranscript,
  mergeTranscriptData,
  sessionQueryKeys,
  transcriptEndIndex,
  type TranscriptData,
} from "../src/lib/api/sessions";

/**
 * Tests for the client half of transcript windowing in
 * `src/lib/api/sessions.ts`. The endpoint serves the tail of a long session, so
 * the cache is a window over the JSONL: merges are keyed by each record's index
 * in the file, and `fetchEarlierTranscript` pulls the page before the window.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

function record(index: number): Record<string, unknown> {
  return { type: "user", uuid: `u-${index}`, message: { role: "user", content: `m${index}` } };
}

function window_(startIndex: number, count: number, overrides?: Partial<TranscriptData>) {
  return {
    records: Array.from({ length: count }, (_, i) => record(startIndex + i)),
    byteOffset: 0,
    startIndex,
    precedingMessageCount: startIndex,
    ...overrides,
  };
}

describe("mergeTranscriptData", () => {
  it("keeps an earlier page ahead of the tail it was paged back from", () => {
    const tail = window_(3, 2, { byteOffset: 900 });
    const earlier = window_(0, 3);

    expect(mergeTranscriptData(tail, earlier)).toStrictEqual({
      records: [record(0), record(1), record(2), record(3), record(4)],
      byteOffset: 900,
      startIndex: 0,
      precedingMessageCount: 0,
    });
  });

  it("takes the primary window's copy of an overlapping record", () => {
    const refreshed = { ...window_(1, 2), records: [{ ...record(1), edited: true }, record(2)] };

    expect(mergeTranscriptData(refreshed, window_(0, 3)).records).toStrictEqual([
      record(0),
      { ...record(1), edited: true },
      record(2),
    ]);
  });

  it("drops a stale window that no longer touches the newest records", () => {
    // A long gap means the client missed records; rendering across the hole
    // would silently splice unrelated turns together.
    expect(mergeTranscriptData(window_(50, 2), window_(0, 3))).toStrictEqual({
      records: [record(50), record(51)],
      byteOffset: 0,
      startIndex: 50,
      precedingMessageCount: 50,
    });
  });

  it("never repeats a record that both windows carry under different indices", () => {
    const shifted = { ...window_(2, 1), records: [record(1)] };

    expect(mergeTranscriptData(shifted, window_(0, 2)).records).toStrictEqual([
      record(0),
      record(1),
    ]);
  });

  it("keeps every held record when a re-broadcast of already-seen lines precedes an append", () => {
    // The watcher re-sends lines the window already holds, so the dedupe drops
    // them; the next append must not land on top of the records that survived.
    const cached = window_(0, 5);

    const rebroadcast = mergeTranscriptData(cached, {
      records: [record(3), record(4)],
      byteOffset: cached.byteOffset,
      startIndex: transcriptEndIndex(cached),
      precedingMessageCount: cached.precedingMessageCount,
    });
    const appended = mergeTranscriptData(rebroadcast, {
      records: [record(5), record(6)],
      byteOffset: rebroadcast.byteOffset,
      startIndex: transcriptEndIndex(rebroadcast),
      precedingMessageCount: rebroadcast.precedingMessageCount,
    });

    expect(appended).toStrictEqual({
      records: [record(0), record(1), record(2), record(3), record(4), record(5), record(6)],
      byteOffset: 0,
      startIndex: 0,
      precedingMessageCount: 0,
    });
  });
});

describe("fetchEarlierTranscript", () => {
  it("requests the page before the cached window and prepends it", async () => {
    const queryClient = new QueryClient();
    const queryKey = sessionQueryKeys.transcript("sess-1");
    queryClient.setQueryData(queryKey, window_(3, 2, { byteOffset: 900 }));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(window_(0, 3)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await fetchEarlierTranscript(queryClient, "sess-1");

    expect(
      fetchSpy.mock.calls.map((call) => {
        const url = new URL(String(call[0]));
        return url.pathname + url.search;
      }),
    ).toStrictEqual(["/api/sessions/sess-1/transcript?before=3"]);
    expect(queryClient.getQueryData<TranscriptData>(queryKey)).toStrictEqual({
      records: [record(0), record(1), record(2), record(3), record(4)],
      byteOffset: 900,
      startIndex: 0,
      precedingMessageCount: 0,
    });
  });

  it("serves concurrent callers one request for the same page", async () => {
    // The scroll sentinel and the deep-link anchor both page backwards, and
    // they page over the same window, so two overlapping asks for the page
    // before it must not become two trips to the server.
    const queryClient = new QueryClient();
    const queryKey = sessionQueryKeys.transcript("sess-1");
    queryClient.setQueryData(queryKey, window_(3, 2, { byteOffset: 900 }));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(window_(0, 3)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await Promise.all([
      fetchEarlierTranscript(queryClient, "sess-1"),
      fetchEarlierTranscript(queryClient, "sess-1"),
    ]);

    expect(fetchSpy.mock.calls.length).toBe(1);
    expect(queryClient.getQueryData<TranscriptData>(queryKey)).toStrictEqual({
      records: [record(0), record(1), record(2), record(3), record(4)],
      byteOffset: 900,
      startIndex: 0,
      precedingMessageCount: 0,
    });
  });

  it("pages again once the previous page has landed", async () => {
    const queryClient = new QueryClient();
    const queryKey = sessionQueryKeys.transcript("sess-1");
    queryClient.setQueryData(queryKey, window_(4, 1));
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const before = Number(new URL(String(input)).searchParams.get("before"));
      return Promise.resolve(
        new Response(JSON.stringify(window_(before - 2, 2)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    await fetchEarlierTranscript(queryClient, "sess-1");
    await fetchEarlierTranscript(queryClient, "sess-1");

    expect(queryClient.getQueryData<TranscriptData>(queryKey)?.startIndex).toBe(0);
  });

  it("does not call the endpoint when the window already starts at the first record", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(sessionQueryKeys.transcript("sess-1"), window_(0, 3));
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await fetchEarlierTranscript(queryClient, "sess-1");

    expect(fetchSpy.mock.calls).toStrictEqual([]);
  });

  it("does not call the endpoint when nothing is cached yet", async () => {
    const queryClient = new QueryClient();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await fetchEarlierTranscript(queryClient, "sess-1");

    expect(fetchSpy.mock.calls).toStrictEqual([]);
  });
});
