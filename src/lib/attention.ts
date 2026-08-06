import type { DisplayState } from "./session-state";

interface AttentionSettings {
  desktopNotifications: boolean;
}

export interface AttentionBadgeSession {
  sessionId: string;
  displayState: DisplayState;
}

/** Shared global and per-session gate for every surface that requests attention. */
function sessionAlertsEnabled(
  settings: AttentionSettings,
  hidden: boolean,
  sessionId: string,
  viewedSessionId: string | null,
): boolean {
  return settings.desktopNotifications && (hidden || sessionId !== viewedSessionId);
}

export function shouldNotify(
  settings: AttentionSettings,
  hidden: boolean,
  permission: NotificationPermission,
  sessionId: string,
  viewedSessionId: string | null,
): boolean {
  return (
    permission === "granted" && sessionAlertsEnabled(settings, hidden, sessionId, viewedSessionId)
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

export function countSessionsNeedingAttention(
  sessions: AttentionBadgeSession[],
  settings: AttentionSettings,
  hidden: boolean,
  viewedSessionId: string | null,
): number {
  return sessions.filter(
    (session) =>
      (session.displayState === "waiting" || session.displayState === "review") &&
      sessionAlertsEnabled(settings, hidden, session.sessionId, viewedSessionId),
  ).length;
}
