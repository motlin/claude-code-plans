import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";

import { useSubscribeSessionStates } from "../hooks/use-claude-events";
import { displayState, type ActivityState, type DisplayState } from "../lib/session-state";
import { hasUnseenWork, subscribeUnseenWork } from "../lib/unread-store";
import { sessionAlertsEnabled } from "./desktop-notification-bridge";
import { useSettings, type Settings } from "./settings-provider";

export interface AttentionBadgeSession {
  sessionId: string;
  displayState: DisplayState;
}

export function countSessionsNeedingAttention(
  sessions: AttentionBadgeSession[],
  settings: Settings,
  hidden: boolean,
  viewedSessionId: string | null,
): number {
  return sessions.filter(
    (session) =>
      (session.displayState === "waiting" || session.displayState === "review") &&
      sessionAlertsEnabled(settings, hidden, session.sessionId, viewedSessionId),
  ).length;
}

function viewedSessionId(router: ReturnType<typeof useRouter>): string | null {
  const sessionMatch = router.state.matches.find((match) =>
    match.routeId.startsWith("/session/$id"),
  );
  if (!sessionMatch || !("id" in sessionMatch.params)) return null;
  const id = sessionMatch.params.id;
  return typeof id === "string" ? id : null;
}

function setAppBadge(count: number): void {
  if (count > 0 && typeof navigator.setAppBadge === "function") {
    navigator.setAppBadge(count).catch(() => {});
  } else if (count === 0 && typeof navigator.clearAppBadge === "function") {
    navigator.clearAppBadge().catch(() => {});
  }
}

/** Side-effect-only component that mirrors the live attention count to browser chrome. */
export function AttentionBadgeBridge(): null {
  const { settings } = useSettings();
  const subscribeSessionStates = useSubscribeSessionStates();
  const router = useRouter();

  useEffect(() => {
    if (typeof document === "undefined" || typeof navigator === "undefined") return;

    const originalTitle = document.title;
    const activityStates = new Map<string, ActivityState>();

    const updateBadge = () => {
      const sessions = Array.from(activityStates, ([sessionId, state]) => ({
        sessionId,
        displayState: displayState(state, hasUnseenWork(sessionId)),
      }));
      const count = countSessionsNeedingAttention(
        sessions,
        settings,
        document.hidden,
        viewedSessionId(router),
      );
      document.title = count > 0 ? `(${count}) ${originalTitle}` : originalTitle;
      setAppBadge(count);
    };

    const unsubscribeUnseenWork = subscribeUnseenWork(updateBadge);
    const unsubscribeSessionStates = subscribeSessionStates((session) => {
      activityStates.set(session.sessionId, session.state);
      updateBadge();
    });
    const unsubscribeRouter = router.subscribe("onResolved", updateBadge);
    document.addEventListener("visibilitychange", updateBadge);
    updateBadge();

    return () => {
      unsubscribeSessionStates();
      unsubscribeUnseenWork();
      unsubscribeRouter();
      document.removeEventListener("visibilitychange", updateBadge);
      document.title = originalTitle;
      if (typeof navigator.clearAppBadge === "function") {
        navigator.clearAppBadge().catch(() => {});
      }
    };
  }, [router, settings, subscribeSessionStates]);

  return null;
}
