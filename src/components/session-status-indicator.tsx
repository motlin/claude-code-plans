import type { ActivityState, DisplayState, WaitHeat } from "../lib/session-state";
import { StatusDot } from "./sidebar/primitives/StatusDot";

export const DISPLAY_STATE_STYLES: Record<DisplayState, string> = {
  waiting: "text-amber-500",
  review: "text-sky-500",
  working: "text-green-500",
  idle: "text-t6",
  unknown: "text-t6",
};

/**
 * Fixed two-column grid so the dot and the status word land at the same x on
 * every row of a session list, regardless of which label the row shows. The dot
 * carries the wait heat (how long the session has been blocked), the word the
 * activity itself.
 */
export function SessionStatusIndicator({ heat, state }: { heat: WaitHeat; state: ActivityState }) {
  return (
    <span
      className="grid grid-cols-[0.625rem_minmax(0,1fr)] items-center gap-1.5 text-xs"
      aria-label={`Session status: ${state}`}
    >
      <StatusDot active heat={heat} />
      <span className={`truncate ${DISPLAY_STATE_STYLES[state]}`}>{state}</span>
    </span>
  );
}
