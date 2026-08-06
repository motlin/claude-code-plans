import type { HookEvent } from "./hook-events";

export type ActivityState = "idle" | "working" | "waiting" | "unknown";

export type DisplayState = ActivityState | "review";

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
