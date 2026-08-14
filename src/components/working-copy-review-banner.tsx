import { GitPullRequest, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelWorkingCopyReview,
  createWorkingCopyReview,
  runWorkingCopyReview,
} from "../lib/api/reviews";
import { useSubscribeReviewOffers } from "../hooks/use-claude-events";
import { useSettings } from "./settings-provider";
import type { Capabilities } from "../lib/capabilities";

export type ReviewOfferAction = "ignore" | "offer" | "start";
type WorkingCopyReviewMode = "off" | "offer" | "auto";

export function reviewOfferAction(mode: WorkingCopyReviewMode): ReviewOfferAction {
  if (mode === "off") return "ignore";
  return mode === "offer" ? "offer" : "start";
}

interface ReviewBannerState {
  sessionId: string;
  reviewId: string | null;
  processId: string | null;
  status: "offered" | "running" | "complete" | "error";
  error: string | null;
}

export function workingCopyReviewDegradedMessage(
  capability: Capabilities["workingCopyReview"],
): string | null {
  if (!capability.enabled || capability.available) return null;
  return capability.installed
    ? "Working-copy review is enabled, but its local runtime is unreachable."
    : "Working-copy review is enabled, but its review skill is not installed.";
}

export function WorkingCopyReviewBanner({
  capability,
}: {
  capability: Capabilities["workingCopyReview"];
}) {
  const { settings } = useSettings();
  const subscribeReviewOffers = useSubscribeReviewOffers();
  const [banner, setBanner] = useState<ReviewBannerState | null>(null);
  const runningSessions = useRef(new Set<string>());
  const cancelledSessions = useRef(new Set<string>());
  const degradedMessage = workingCopyReviewDegradedMessage(capability);

  const startReview = useCallback(async (sessionId: string) => {
    if (runningSessions.current.has(sessionId)) return;
    runningSessions.current.add(sessionId);
    setBanner({ sessionId, reviewId: null, processId: null, status: "running", error: null });
    try {
      const reviewId = await createWorkingCopyReview(sessionId);
      if (cancelledSessions.current.has(sessionId)) return;
      const run = await runWorkingCopyReview(reviewId);
      if (cancelledSessions.current.has(sessionId)) {
        await cancelWorkingCopyReview(reviewId, run.processId);
        return;
      }
      setBanner({
        sessionId,
        reviewId,
        processId: run.processId,
        status: "running",
        error: null,
      });
      const output = await run.completion;
      if (cancelledSessions.current.has(sessionId)) return;
      const runnerError = output
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as { type?: unknown; message?: unknown })
        .find((event) => event.type === "error");
      if (runnerError) {
        throw new Error(
          typeof runnerError.message === "string" ? runnerError.message : "Review runner failed",
        );
      }
      setBanner({ sessionId, reviewId, processId: null, status: "complete", error: null });
    } catch (error) {
      if (cancelledSessions.current.has(sessionId)) return;
      setBanner({
        sessionId,
        reviewId: null,
        processId: null,
        status: "error",
        error: error instanceof Error ? error.message : "Review failed",
      });
    } finally {
      runningSessions.current.delete(sessionId);
      cancelledSessions.current.delete(sessionId);
    }
  }, []);

  useEffect(
    () =>
      subscribeReviewOffers((sessionId) => {
        if (!capability.available) return;
        const action = reviewOfferAction(settings.capabilities.workingCopyReview.config.offerMode);
        if (action === "ignore") return;
        if (action === "start") {
          void startReview(sessionId);
          return;
        }
        setBanner({ sessionId, reviewId: null, processId: null, status: "offered", error: null });
      }),
    [
      capability.available,
      settings.capabilities.workingCopyReview.config.offerMode,
      startReview,
      subscribeReviewOffers,
    ],
  );

  if (degradedMessage !== null) {
    return (
      <div
        role="alert"
        className="mx-6 mt-4 rounded-md border border-red-500/50 bg-red-950/30 px-4 py-3 text-sm font-medium text-red-200"
      >
        {degradedMessage}
      </div>
    );
  }

  if (banner === null) return null;

  async function cancel(activeBanner: ReviewBannerState): Promise<void> {
    cancelledSessions.current.add(activeBanner.sessionId);
    if (activeBanner.reviewId && activeBanner.processId) {
      await cancelWorkingCopyReview(activeBanner.reviewId, activeBanner.processId);
    }
    setBanner(null);
  }

  return (
    <div className="mx-6 mt-4 flex items-center gap-3 rounded-md border border-accent-100/30 bg-surface-1 px-4 py-2.5 text-sm text-secondary shadow-sm">
      {banner.status === "running" ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent-100" />
      ) : (
        <GitPullRequest className="h-4 w-4 shrink-0 text-accent-100" />
      )}
      <div className="min-w-0 flex-1">
        <div className="font-medium">
          {banner.status === "offered" && "Review this turn's uncommitted changes?"}
          {banner.status === "running" && "Reviewing uncommitted changes…"}
          {banner.status === "complete" && "Working-copy review complete"}
          {banner.status === "error" && "Working-copy review failed"}
        </div>
        {banner.error && (
          <div className="mt-0.5 truncate text-xs text-danger-000">{banner.error}</div>
        )}
      </div>
      {banner.status === "offered" && (
        <button
          type="button"
          onClick={() => void startReview(banner.sessionId)}
          className="rounded-md bg-accent-100 px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-100/80"
        >
          Review
        </button>
      )}
      {banner.status === "complete" && banner.reviewId && (
        <a
          href={`/review/${encodeURIComponent(banner.reviewId)}`}
          className="rounded-md bg-accent-100 px-3 py-1.5 text-xs font-medium text-white no-underline hover:bg-accent-100/80"
        >
          View findings
        </a>
      )}
      {banner.status === "running" && banner.processId && (
        <button
          type="button"
          onClick={() => void cancel(banner)}
          className="rounded-md border border-strong px-3 py-1.5 text-xs text-secondary hover:bg-surface-0"
        >
          Cancel
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          if (banner.status === "running") {
            void cancel(banner);
          } else {
            setBanner(null);
          }
        }}
        aria-label="Dismiss working-copy review"
        className="text-t6 hover:text-secondary"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
