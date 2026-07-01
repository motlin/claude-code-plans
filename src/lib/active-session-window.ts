/**
 * A session counts as "active" when its most recent activity falls within this
 * window. Shared by the server-side scan (`scanActiveSessions`) and the
 * client-side default (`DEFAULTS.activeTimeoutSec`) so the two never drift.
 */
export const ACTIVE_SESSION_WINDOW_MS = 5 * 60 * 1000;
