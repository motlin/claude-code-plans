import {findLastPendingToolUse, type PendingToolUse, toolUseProgress} from "./approval-dock";
import type {PendingPlan} from "./hook-events";
import type {SessionSummaryState} from "./session-state";

/**
 * The hook-reported plan to dock above the composer: the session waits on an
 * ExitPlanMode the CLI has not written to the JSONL yet. Once the record is on
 * disk and awaiting, the transcript's own plan card answers it instead; once
 * it is answered there, the lagging hook state never docks it again.
 */
export function dockedHookPlan({
	hookPlan,
	state,
	records,
}: {
	hookPlan: PendingPlan | null | undefined;
	state: SessionSummaryState | null;
	records: readonly unknown[];
}): PendingPlan | null {
	if (hookPlan === null || hookPlan === undefined || state !== "waiting") return null;
	if (hookPlan.toolUseId !== "" && toolUseProgress(records, hookPlan.toolUseId) !== "absent") return null;
	return findLastPendingToolUse(records)?.name === "ExitPlanMode" ? null : hookPlan;
}

/**
 * The on-disk ExitPlanMode the session waits on, which upstream answers in its
 * own inline approval card after the transcript, or null.
 */
export function inlinePlanToolUseId(
	state: SessionSummaryState | null,
	pendingCall: PendingToolUse | null,
): string | null {
	return state === "waiting" && pendingCall?.name === "ExitPlanMode" ? pendingCall.id : null;
}
