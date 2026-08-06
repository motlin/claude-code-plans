import { useCallback, useEffect, useSyncExternalStore } from "react";

import { displayState, type ActivityState, type DisplayState } from "../lib/session-state";
import {
  hasUnseenWork,
  markSeen,
  markUnseen,
  observeSessionState,
  subscribeUnseenWork,
} from "../lib/unread-store";

export function useHasUnseenWork(sessionId: string): boolean {
  const getSnapshot = useCallback(() => hasUnseenWork(sessionId), [sessionId]);
  return useSyncExternalStore(subscribeUnseenWork, getSnapshot, () => false);
}

function useSessionDisplayState(sessionId: string, state: ActivityState): DisplayState {
  const unseen = useHasUnseenWork(sessionId);

  useEffect(() => observeSessionState(sessionId, state), [sessionId, state]);

  return displayState(state, unseen);
}

const STATE_STYLES: Record<DisplayState, string> = {
  waiting: "text-amber-500",
  review: "text-sky-500",
  working: "text-green-500",
  idle: "text-text-500",
  unknown: "text-text-500",
};

export function SessionUnreadControl({
  sessionId,
  state,
}: {
  sessionId: string;
  state: ActivityState;
}) {
  const shownState = useSessionDisplayState(sessionId, state);

  // Only idle/review rows get a manual control: working rows would re-raise the latch a second
  // later, making a mark-seen action look broken and inviting users to clear unfinished work.
  const canToggle = shownState === "idle" || shownState === "review";

  return (
    <div className="flex items-center gap-1.5 text-[10px]" data-session-state={shownState}>
      <span className={STATE_STYLES[shownState]}>
        {shownState === "review" ? "needs review" : shownState}
      </span>
      {canToggle && (
        <button
          type="button"
          className="cursor-pointer text-xs text-text-500 transition-colors hover:text-text-000"
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
