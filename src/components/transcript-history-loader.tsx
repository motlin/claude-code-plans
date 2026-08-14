import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { fetchEarlierTranscript } from "../lib/api/sessions";

/**
 * The element that actually scrolls above `node`. The app scrolls `<main>`, not
 * the window, so `window.scrollY` is a dead end here; walking up to the nearest
 * `overflow-y` ancestor keeps this correct wherever the transcript is mounted,
 * and falls back to the document scroller when nothing else scrolls.
 */
export function findScrollContainer(node: Element | null): Element {
  for (let element = node?.parentElement ?? null; element; element = element.parentElement) {
    const { overflowY } = getComputedStyle(element);
    if (overflowY === "auto" || overflowY === "scroll") return element;
  }
  return document.scrollingElement ?? document.documentElement;
}

/**
 * The `root` an IntersectionObserver should measure against, given the element
 * that scrolls. `null` means the viewport, which is only right when the
 * document itself scrolls: the app shell scrolls `<main>` while leaving the
 * document parked partway down, so a viewport-rooted observer would call the
 * top of the transcript "off screen" no matter where the reader scrolled to.
 */
export function toObserverRoot(scroller: Element): Element | null {
  if (scroller === document.documentElement) return null;
  if (scroller === document.scrollingElement) return null;
  return scroller;
}

interface TranscriptHistoryLoaderProps {
  sessionId: string;
  /** Index of the oldest record the client holds; 0 means nothing is missing. */
  startIndex: number;
}

/**
 * Head of a windowed transcript. The endpoint serves the tail of a long
 * session's JSONL, so everything before `startIndex` is still on the server;
 * this pulls the previous page when the reader scrolls back to it, and offers a
 * button for anyone who would rather not scroll (or whose last attempt failed).
 */
export function TranscriptHistoryLoader({ sessionId, startIndex }: TranscriptHistoryLoaderProps) {
  const queryClient = useQueryClient();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const inFlightRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  /**
   * Whether seeing the sentinel counts as the reader asking for history. The
   * session view opens scrolled to the newest message, but it renders at the
   * top first -- auto-loading on that opening frame would fetch history nobody
   * asked for, on every visit. So wait until the sentinel has been out of view
   * once; from then on, seeing it means the reader scrolled to it. This
   * outlives the observer below, which is rebuilt around every landed page.
   */
  const armedRef = useRef(false);
  const anchorRef = useRef<{ scroller: Element; scrollHeight: number; scrollTop: number } | null>(
    null,
  );

  const loadEarlier = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setIsLoading(true);
    const scroller = findScrollContainer(sentinelRef.current);
    anchorRef.current = {
      scroller,
      scrollHeight: scroller.scrollHeight,
      scrollTop: scroller.scrollTop,
    };
    try {
      await fetchEarlierTranscript(queryClient, sessionId);
      setError("");
    } catch (cause) {
      // A stale anchor would yank a later append's scroll position, so drop it.
      anchorRef.current = null;
      setError(cause instanceof Error ? cause.message : "Failed to load earlier messages");
    } finally {
      inFlightRef.current = false;
      setIsLoading(false);
    }
  }, [queryClient, sessionId]);

  /**
   * Prepending records grows the transcript upwards, which would throw the
   * reader backwards by the height of the page they just asked for. `startIndex`
   * moves exactly when that page lands, and a layout effect runs after React
   * commits it but before the browser paints, so putting the scroll position
   * back here is invisible -- and it leaves the sentinel above the viewport,
   * which is what lets the next scroll up ask for the next page.
   */
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    anchorRef.current = null;
    anchor.scroller.scrollTop =
      anchor.scrollTop + (anchor.scroller.scrollHeight - anchor.scrollHeight);
  }, [startIndex]);

  /**
   * Watch the top of the transcript. Re-running on every landed page is what
   * keeps paging going when the page that landed was too short to push the
   * sentinel back out of view: nothing about the intersection changed, so a
   * standing observer would say nothing, while a fresh one opens by
   * re-delivering the current state -- and that state is "still at the top,
   * still wanting more". Arming has to survive that rebuild for the
   * re-delivery to read as an ask rather than as another opening frame.
   */
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        // A fast scroll down and back up arrives as one callback carrying both
        // transitions, so walk the whole batch in order rather than reading
        // only the first entry and throwing the arrival away.
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            armedRef.current = true;
            continue;
          }
          if (armedRef.current) void loadEarlier();
        }
      },
      {
        root: toObserverRoot(findScrollContainer(sentinel)),
        // Start the fetch a screenful early so the older messages are usually
        // already in place by the time the reader scrolls onto them.
        rootMargin: "600px 0px 0px 0px",
      },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadEarlier, startIndex]);

  if (startIndex === 0) return null;

  return (
    <div
      ref={sentinelRef}
      data-testid="transcript-history-loader"
      className="mx-auto flex w-full max-w-3xl flex-col items-center gap-1 px-8 pt-4 text-xs text-t6"
    >
      <button
        type="button"
        onClick={() => void loadEarlier()}
        disabled={isLoading}
        className="cursor-pointer rounded-md border border-border bg-surface-0 px-3 py-1.5 transition-colors hover:text-primary disabled:cursor-default disabled:opacity-60"
      >
        {isLoading ? "Loading earlier messages…" : `Load ${startIndex} earlier records`}
      </button>
      {error && <span className="text-danger-000">{error}</span>}
    </div>
  );
}
