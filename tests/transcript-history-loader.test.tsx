// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  TranscriptHistoryLoader,
  findScrollContainer,
  toObserverRoot,
} from "../src/components/transcript-history-loader";
import { sessionQueryKeys, type TranscriptData } from "../src/lib/api/sessions";

/**
 * Tests for the head of a windowed transcript. The endpoint serves the tail of
 * a long session, so this component is the only way back to the older records:
 * an IntersectionObserver pulls the previous page when the reader scrolls to
 * the top, and the button covers everyone else.
 */

let intersect: (...states: boolean[]) => void = () => undefined;

class TestIntersectionObserver {
  constructor(private readonly callback: IntersectionObserverCallback) {
    intersect = (...states: boolean[]) =>
      this.callback(
        states.map((isIntersecting) => ({ isIntersecting }) as IntersectionObserverEntry),
        this as unknown as IntersectionObserver,
      );
  }
  observe() {}
  disconnect() {}
}

vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);

afterEach(() => {
  vi.restoreAllMocks();
});

function record(index: number): Record<string, unknown> {
  return { type: "user", uuid: `u-${index}`, message: { role: "user", content: `m${index}` } };
}

function renderLoader(cached: TranscriptData) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(sessionQueryKeys.transcript("sess-1"), cached);
  const view = render(
    <QueryClientProvider client={queryClient}>
      <TranscriptHistoryLoader sessionId="sess-1" startIndex={cached.startIndex} />
    </QueryClientProvider>,
  );
  const rerenderWithStartIndex = (startIndex: number) =>
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <TranscriptHistoryLoader sessionId="sess-1" startIndex={startIndex} />
      </QueryClientProvider>,
    );
  return { queryClient, rerenderWithStartIndex };
}

function mockEarlierPage(page: TranscriptData) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(page), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

/** Serves a two-record page for whatever `?before=` the client asks for. */
function mockPagedHistory() {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const before = Number(new URL(String(input), "http://localhost").searchParams.get("before"));
    const startIndex = Math.max(0, before - 2);
    const page: TranscriptData = {
      records: Array.from({ length: before - startIndex }, (_, i) => record(startIndex + i)),
      byteOffset: 900,
      startIndex,
      precedingMessageCount: startIndex,
    };
    return Promise.resolve(
      new Response(JSON.stringify(page), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
}

const TAIL: TranscriptData = {
  records: [record(2), record(3)],
  byteOffset: 900,
  startIndex: 2,
  precedingMessageCount: 2,
};
const EARLIER_PAGE: TranscriptData = {
  records: [record(0), record(1)],
  byteOffset: 900,
  startIndex: 0,
  precedingMessageCount: 0,
};

describe("TranscriptHistoryLoader", () => {
  it("renders nothing once the window reaches the first record", () => {
    renderLoader({ ...EARLIER_PAGE, records: [record(0), record(1)] });

    expect(screen.queryByTestId("transcript-history-loader")).toBeNull();
  });

  it("loads the earlier page when the reader scrolls it into view", async () => {
    mockEarlierPage(EARLIER_PAGE);
    const { queryClient } = renderLoader(TAIL);

    intersect(false);
    intersect(true);

    await waitFor(() =>
      expect(
        queryClient.getQueryData<TranscriptData>(sessionQueryKeys.transcript("sess-1")),
      ).toStrictEqual({
        records: [record(0), record(1), record(2), record(3)],
        byteOffset: 900,
        startIndex: 0,
        precedingMessageCount: 0,
      }),
    );
  });

  it("loads the earlier page when the button is used instead of scrolling", async () => {
    const fetchSpy = mockEarlierPage(EARLIER_PAGE);
    const { queryClient } = renderLoader(TAIL);

    screen.getByRole("button", { name: "Load 2 earlier records" }).click();

    await waitFor(() => expect(fetchSpy.mock.calls.length).toBe(1));
    expect(
      queryClient.getQueryData<TranscriptData>(sessionQueryKeys.transcript("sess-1"))?.startIndex,
    ).toBe(0);
  });

  it("keeps the reader in place when the prepended page grows the transcript", async () => {
    mockEarlierPage(EARLIER_PAGE);
    const { rerenderWithStartIndex } = renderLoader(TAIL);
    const scroller = screen.getByTestId("transcript-history-loader").parentElement!;
    scroller.style.overflowY = "auto";
    let scrollHeight = 1_000;
    Object.defineProperty(scroller, "scrollHeight", { get: () => scrollHeight });
    scroller.scrollTop = 40;

    intersect(false);
    intersect(true);
    await waitFor(() => expect(screen.getByRole("button").hasAttribute("disabled")).toBe(false));
    // The page landing is what grows the transcript and moves `startIndex`.
    scrollHeight = 1_600;
    rerenderWithStartIndex(0);

    expect(scroller.scrollTop).toBe(640);
  });

  it("ignores the opening frame, where the view has not yet scrolled to the newest message", async () => {
    const fetchSpy = mockEarlierPage(EARLIER_PAGE);
    renderLoader(TAIL);

    intersect(true);

    await waitFor(() =>
      expect(screen.getByRole("button").textContent).toBe("Load 2 earlier records"),
    );
    expect(fetchSpy.mock.calls).toStrictEqual([]);
  });

  it("loads when one callback carries both the exit and the return", async () => {
    // A fast scroll down and back up is delivered as a single batch.
    mockEarlierPage(EARLIER_PAGE);
    const { queryClient } = renderLoader(TAIL);

    intersect(false, true);

    await waitFor(() =>
      expect(
        queryClient.getQueryData<TranscriptData>(sessionQueryKeys.transcript("sess-1"))?.startIndex,
      ).toBe(0),
    );
  });

  it("keeps paging when the landed page is too short to move the sentinel out of view", async () => {
    // A page that renders shorter than the 600px rootMargin leaves the sentinel
    // intersecting, so the observer watching the next page has only its opening
    // delivery to go on -- and that delivery says "still intersecting".
    const fetchSpy = mockPagedHistory();
    const { rerenderWithStartIndex } = renderLoader({ ...TAIL, startIndex: 6 });

    intersect(false);
    intersect(true);
    await waitFor(() => expect(fetchSpy.mock.calls.length).toBe(1));
    rerenderWithStartIndex(4);
    intersect(true);

    await waitFor(() => expect(fetchSpy.mock.calls.length).toBe(2));
  });

  it("still ignores the opening frame after a page lands without the reader scrolling", async () => {
    // The deep-link path pages backwards on its own. Those landings re-run the
    // observer effect, but the reader never scrolled, so the sentinel sitting
    // in view is still the opening frame and must not fetch.
    const fetchSpy = mockPagedHistory();
    const { rerenderWithStartIndex } = renderLoader({ ...TAIL, startIndex: 6 });

    rerenderWithStartIndex(4);
    intersect(true);

    await waitFor(() =>
      expect(screen.getByRole("button").textContent).toBe("Load 4 earlier records"),
    );
    expect(fetchSpy.mock.calls).toStrictEqual([]);
  });

  it("surfaces a failure instead of silently leaving the history unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("fabricated network failure"));
    renderLoader(TAIL);

    intersect(false);
    intersect(true);

    await waitFor(() => expect(screen.getByText("fabricated network failure")).toBeDefined());
  });
});

describe("toObserverRoot", () => {
  it("measures against the scrolling element the transcript lives in", () => {
    const main = document.createElement("main");
    document.body.append(main);

    expect(toObserverRoot(main)).toBe(main);
  });

  it("measures against the viewport when the document itself scrolls", () => {
    expect(toObserverRoot(document.documentElement)).toBeNull();
  });
});

describe("findScrollContainer", () => {
  it("falls back to the document scroller when nothing above scrolls", () => {
    const node = document.createElement("div");
    document.body.append(node);

    expect(findScrollContainer(node)).toBe(document.documentElement);
  });

  it("finds the scrolling ancestor the transcript actually lives in", () => {
    // Mirrors the app shell: <main class="overflow-y-auto"> scrolls, not the
    // window, so anchoring against `window.scrollY` would move nothing.
    const main = document.createElement("main");
    main.style.overflowY = "auto";
    const inner = document.createElement("div");
    const node = document.createElement("div");
    inner.append(node);
    main.append(inner);
    document.body.append(main);

    expect(findScrollContainer(node)).toBe(main);
  });
});
