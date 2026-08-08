import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { sessionQueryKeys } from "../lib/api/sessions";
import {
  updateSessionViewedState,
  updateSessionVisibility,
  type SessionViewedState,
} from "../lib/api/viewed-state";

const VIEW_DWELL_MS = 1_500;
const VISIBILITY_HEARTBEAT_MS = 10_000;

interface VisibilityDwellDependencies {
  cancel: (timer: ReturnType<typeof setTimeout>) => void;
  onDwell: () => void;
  onVisibilityChange: (visible: boolean) => void;
  schedule: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
}

interface BackgroundSyncOptions {
  level?: "debug" | "warn";
  onError?: (error: unknown) => void;
}

/**
 * Run a fire-and-forget presence sync without ever producing an unhandled
 * promise rejection.
 *
 * Visibility pings and dwell auto-marking are best-effort: the next heartbeat
 * re-reports the same state, so a single failed call costs nothing. Failures are
 * routine (a tab closing aborts the in-flight request, and the dev server drops
 * connections on every restart), and letting those bubble turns ordinary
 * background churn into red console errors.
 */
export function runBackgroundSync(
  operation: string,
  call: () => Promise<unknown>,
  { level = "debug", onError }: BackgroundSyncOptions = {},
): void {
  // `.then(call)` also traps a synchronous throw from the factory itself.
  void Promise.resolve()
    .then(call)
    .catch((error: unknown) => {
      console[level](`[session-viewed-state] background ${operation} failed`, error);
      onError?.(error);
    });
}

export function createRetryableSync(
  call: () => Promise<unknown>,
  run: typeof runBackgroundSync = runBackgroundSync,
): { attempt: (operation: string) => void; retryIfFailed: (operation: string) => void } {
  let failed = false;

  const attempt = (operation: string): void => {
    failed = false;
    run(operation, call, {
      level: "warn",
      onError: () => {
        failed = true;
      },
    });
  };

  const retryIfFailed = (operation: string): void => {
    if (failed) attempt(operation);
  };

  return { attempt, retryIfFailed };
}

export function createVisibilityDwellController(dependencies: VisibilityDwellDependencies): {
  setVisible: (visible: boolean) => void;
  stop: () => void;
} {
  let visible = false;
  let dwellTimer: ReturnType<typeof setTimeout> | null = null;

  const setVisible = (nextVisible: boolean): void => {
    if (visible === nextVisible) return;
    visible = nextVisible;
    dependencies.onVisibilityChange(visible);
    if (!visible) {
      if (dwellTimer) dependencies.cancel(dwellTimer);
      dwellTimer = null;
      return;
    }
    dwellTimer = dependencies.schedule(() => {
      dwellTimer = null;
      if (visible) dependencies.onDwell();
    }, VIEW_DWELL_MS);
  };

  const stop = (): void => {
    if (dwellTimer) dependencies.cancel(dwellTimer);
    dwellTimer = null;
    if (visible) dependencies.onVisibilityChange(false);
    visible = false;
  };

  return { setVisible, stop };
}

export function useSessionViewedState(
  sessionId: string,
  currentMessageIndex: number,
): {
  markReviewed: () => Promise<SessionViewedState>;
  markUnreviewed: () => Promise<SessionViewedState>;
  visibilityRef: (element: HTMLDivElement | null) => void;
} {
  const queryClient = useQueryClient();
  const [visibilityElement, setVisibilityElement] = useState<HTMLDivElement | null>(null);
  const visibilityRef = useCallback((element: HTMLDivElement | null) => {
    setVisibilityElement(element);
  }, []);

  const applyViewedState = useCallback(
    (viewedState: SessionViewedState): SessionViewedState => {
      queryClient.setQueryData(sessionQueryKeys.detail(sessionId), (previous: unknown) => {
        if (previous === null || typeof previous !== "object") return previous;
        return { ...previous, viewedState };
      });
      void queryClient.invalidateQueries({ queryKey: ["herdr", "panes"] });
      return viewedState;
    },
    [queryClient, sessionId],
  );

  const markReviewed = useCallback(async () => {
    return applyViewedState(
      await updateSessionViewedState(sessionId, "reviewed", currentMessageIndex),
    );
  }, [applyViewedState, currentMessageIndex, sessionId]);

  const markUnreviewed = useCallback(async () => {
    return applyViewedState(
      await updateSessionViewedState(sessionId, "unreviewed", currentMessageIndex),
    );
  }, [applyViewedState, currentMessageIndex, sessionId]);

  const markReviewedRef = useRef(markReviewed);
  markReviewedRef.current = markReviewed;

  useEffect(() => {
    if (!visibilityElement) return;
    const clientId = `${Date.now().toString(36)}-${Math.random().toString(36)}`;
    let intersecting = false;

    const controller = createVisibilityDwellController({
      cancel: clearTimeout,
      onDwell: () => {
        runBackgroundSync("mark-reviewed", () => markReviewedRef.current());
      },
      onVisibilityChange: (visible) => {
        runBackgroundSync("visibility-update", () =>
          updateSessionVisibility(sessionId, clientId, visible),
        );
      },
      schedule: setTimeout,
    });
    const updateVisibility = (): void => {
      controller.setVisible(intersecting && document.visibilityState === "visible");
    };
    const observer = new IntersectionObserver(([entry]) => {
      intersecting = entry?.isIntersecting === true;
      updateVisibility();
    });
    observer.observe(visibilityElement);
    document.addEventListener("visibilitychange", updateVisibility);
    const heartbeat = setInterval(() => {
      if (intersecting && document.visibilityState === "visible") {
        runBackgroundSync("visibility-heartbeat", () =>
          updateSessionVisibility(sessionId, clientId, true),
        );
      }
    }, VISIBILITY_HEARTBEAT_MS);

    return () => {
      clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", updateVisibility);
      observer.disconnect();
      controller.stop();
    };
  }, [sessionId, visibilityElement]);

  return { markReviewed, markUnreviewed, visibilityRef };
}
