import {findLastPendingToolUse} from "./approval-dock";
import type {PendingPlan} from "./hook-events";
import type {SessionSummaryState} from "./session-state";

/**
 * The hook-reported plan to dock above the composer: the session waits on an
 * ExitPlanMode the CLI has not written to the JSONL yet. Once the record is on
 * disk and awaiting, the transcript's own plan card answers it instead.
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
	return findLastPendingToolUse(records)?.name === "ExitPlanMode" ? null : hookPlan;
}
