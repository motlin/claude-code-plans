import { useEffect, useRef } from "react";
import { useRouter } from "@tanstack/react-router";

import { useSubscribeSessionStates } from "../hooks/use-claude-events";
import { displayState, type DisplayState } from "../lib/session-state";
import { hasUnseenWork, subscribeUnseenWork } from "../lib/unread-store";
import { useSettings, type Settings } from "./settings-provider";

/**
 * A visible tab suppresses only the session already on screen. Notifications
 * from other sessions still need to get the user's attention.
 */
export function shouldNotify(
  settings: Settings,
  hidden: boolean,
  permission: NotificationPermission,
  sessionId: string,
  viewedSessionId: string | null,
): boolean {
  return (
    settings.desktopNotifications &&
    permission === "granted" &&
    (hidden || sessionId !== viewedSessionId)
  );
}

export function notificationCopy(
  previous: DisplayState | undefined,
  next: DisplayState,
  label: string,
): string | null {
  if (previous === next) return null;
  if (next === "waiting") return `${label} is waiting on you`;
  if (next === "review") return `${label} finished — needs review`;
  return null;
}

function viewedSessionId(router: ReturnType<typeof useRouter>): string | null {
  const sessionMatch = router.state.matches.find((match) =>
    match.routeId.startsWith("/session/$id"),
  );
  if (!sessionMatch || !("id" in sessionMatch.params)) return null;
  const id = sessionMatch.params.id;
  return typeof id === "string" ? id : null;
}

/**
 * Side-effect-only component (renders nothing). It seeds current display states
 * on subscribe, then raises one native notification for each later transition
 * into waiting or review.
 */
export function DesktopNotificationBridge(): null {
  const { settings } = useSettings();
  const subscribeSessionStates = useSubscribeSessionStates();
  const router = useRouter();
  const previousStates = useRef(new Map<string, DisplayState>());
  const activityStates = useRef(new Map<string, Parameters<typeof displayState>[0]>());

  useEffect(() => {
    if (typeof Notification === "undefined") return;

    const seedFromUnseenWork = () => {
      for (const [sessionId, state] of activityStates.current) {
        previousStates.current.set(sessionId, displayState(state, hasUnseenWork(sessionId)));
      }
    };
    const unsubscribeUnseenWork = subscribeUnseenWork(seedFromUnseenWork);
    let seeding = true;
    const unsubscribeSessionStates = subscribeSessionStates((session) => {
      if (typeof document === "undefined") return;
      activityStates.current.set(session.sessionId, session.state);
      const next = displayState(session.state, hasUnseenWork(session.sessionId));
      const previous = previousStates.current.get(session.sessionId);
      previousStates.current.set(session.sessionId, next);

      const copy = notificationCopy(previous, next, session.label);
      if (seeding || copy === null) return;
      if (
        !shouldNotify(
          settings,
          document.hidden,
          Notification.permission,
          session.sessionId,
          viewedSessionId(router),
        )
      ) {
        return;
      }

      const notification = new Notification(copy, {
        tag: session.sessionId,
      });
      notification.onclick = () => {
        window.focus();
        void router.navigate({
          to: "/session/$id",
          params: { id: session.sessionId },
        });
        notification.close();
      };
    });
    seeding = false;

    return () => {
      unsubscribeSessionStates();
      unsubscribeUnseenWork();
    };
  }, [subscribeSessionStates, settings, router]);

  return null;
}
