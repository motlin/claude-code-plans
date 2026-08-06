import type { HookEvent } from "./hook-events";

export type ActivityState = "idle" | "working" | "waiting" | "unknown";

export type DisplayState = ActivityState | "review";

export type WaitHeat = "" | "warm" | "hot";

const WAIT_WARM_MS = 10 * 60 * 1000;
const WAIT_HOT_MS = 30 * 60 * 1000;

export const STATE_RANK: Record<DisplayState, number> = {
  waiting: 0,
  review: 1,
  working: 2,
  idle: 3,
  unknown: 4,
};

export interface UrgencySortableSession {
  state: DisplayState;
  lastModified: number;
}

export function compareByUrgency(
  first: UrgencySortableSession,
  second: UrgencySortableSession,
): number {
  return (
    STATE_RANK[first.state] - STATE_RANK[second.state] || second.lastModified - first.lastModified
  );
}

export function waitHeat(
  displayState: DisplayState,
  blockedSince: string | null,
  now: number,
): WaitHeat {
  if (displayState !== "waiting" || blockedSince === null) return "";

  const elapsed = now - Date.parse(blockedSince);
  if (elapsed >= WAIT_HOT_MS) return "hot";
  if (elapsed >= WAIT_WARM_MS) return "warm";
  return "";
}

export function stateForEvent(event: HookEvent): ActivityState | null {
  switch (event.hook_event_name) {
    case "UserPromptSubmit":
      return "working";
    case "PreToolUse":
      return event.tool_name === "AskUserQuestion" || event.tool_name === "ExitPlanMode"
        ? "waiting"
        : "working";
    case "PostToolUse":
    case "PostToolUseFailure":
    case "MessageDisplay":
      return "working";
    case "PreCompact":
      return event.trigger === "manual" ? "working" : null;
    case "PostCompact":
      return event.reason === "manual" ? "idle" : null;
    case "Stop":
    case "SessionEnd":
      return "idle";
    default:
      return null;
  }
}
