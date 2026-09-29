import { useCallback, useSyncExternalStore } from "react";

import {
  displayState,
  isLiveSessionState,
  sessionStateKind,
  type ActivityState,
  type DisplayState,
  type SessionSummaryState,
} from "../lib/session-state";
import { hasUnseenWork, markSeen, markUnseen, subscribeUnseenWork } from "../lib/unread-store";
import { DISPLAY_STATE_STYLES } from "./session-status-indicator";
import { SessionStateIcon } from "./status-dot";

export function useHasUnseenWork(sessionId: string): boolean {
  const getSnapshot = useCallback(() => hasUnseenWork(sessionId), [sessionId]);
  return useSyncExternalStore(subscribeUnseenWork, getSnapshot, () => false);
}

function useSessionDisplayState(sessionId: string, state: ActivityState): DisplayState {
  return displayState(state, useHasUnseenWork(sessionId));
}

/**
 * Upstream row icon for a session the active-session feed reports as live. A list row whose
 * summary state has not caught up yet (still "ended") shows as running.
 */
export function LiveSessionStateIcon({
  sessionId,
  state,
}: {
  sessionId: string;
  state: SessionSummaryState;
}) {
  const unseen = useHasUnseenWork(sessionId);
  const shown = isLiveSessionState(state) ? displayState(state, unseen) : "working";
  return <SessionStateIcon kind={sessionStateKind(shown)} />;
}

export function SessionUnreadControl({
  sessionId,
  state,
}: {
  sessionId: string;
  state: SessionSummaryState;
}) {
  if (!isLiveSessionState(state)) return null;

  return <LiveSessionUnreadControl sessionId={sessionId} state={state} />;
}

function LiveSessionUnreadControl({
  sessionId,
  state,
}: {
  sessionId: string;
  state: ActivityState;
}) {
  const shownState = useSessionDisplayState(sessionId, state);

  // Only idle/review rows get a manual control: the server marks a turn unseen when it stops, so
  // clearing a working row would be undone a moment later and invites clearing unfinished work.
  const canToggle = shownState === "idle" || shownState === "review";

  return (
    <div className="flex items-center gap-1.5 text-[10px]" data-session-state={shownState}>
      <span className={DISPLAY_STATE_STYLES[shownState]}>
        {shownState === "review" ? "needs review" : shownState}
      </span>
      {canToggle && (
        <button
          type="button"
          className="cursor-pointer text-xs text-t6 transition-colors hover:text-primary"
          title={shownState === "review" ? "Mark seen" : "Mark unseen"}
          aria-label={shownState === "review" ? "Mark seen" : "Mark unseen"}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (shownState === "review") markSeen(sessionId);
            else markUnseen(sessionId);
          }}
        >
          {shownState === "review" ? "○" : "●"}
        </button>
      )}
    </div>
  );
}
