import type { DisplayState } from "./session-state";

interface AttentionSettings {
  notifyCompletions: boolean;
  notifyPermissionRequests: boolean;
}

export interface AttentionBadgeSession {
  sessionId: string;
  displayState: DisplayState;
  /** Archived sessions never ask for attention. */
  archived: boolean;
}

/** Waiting asks for a permission decision; review means a response completed. */
function kindEnabled(settings: AttentionSettings, state: DisplayState): boolean {
  if (state === "waiting") return settings.notifyPermissionRequests;
  if (state === "review") return settings.notifyCompletions;
  return false;
}

/** Shared kind and per-session gate for every surface that requests attention. */
function sessionAlertsEnabled(
  settings: AttentionSettings,
  state: DisplayState,
  hidden: boolean,
  sessionId: string,
  viewedSessionId: string | null,
): boolean {
  return kindEnabled(settings, state) && (hidden || sessionId !== viewedSessionId);
}

export function shouldNotify(
  settings: AttentionSettings,
  state: DisplayState,
  hidden: boolean,
  permission: NotificationPermission,
  sessionId: string,
  viewedSessionId: string | null,
  archived: boolean,
): boolean {
  return (
    permission === "granted" &&
    !archived &&
    sessionAlertsEnabled(settings, state, hidden, sessionId, viewedSessionId)
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
      !session.archived &&
      sessionAlertsEnabled(
        settings,
        session.displayState,
        hidden,
        session.sessionId,
        viewedSessionId,
      ),
  ).length;
}

const ATTENTION_COUNT_PREFIX = /^\(\d+\) /;

/** Drops the `(N) ` attention count that the badge bridge prefixes onto `document.title`. */
export function stripAttentionCount(title: string): string {
  return title.replace(ATTENTION_COUNT_PREFIX, "");
}
