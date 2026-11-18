import type {ClientToolCall} from "../components/tool-renderers/types";
import type {NudgeMemory} from "./safety-nudge-memory";

/*
 * Upstream's "jj" safety-fact cards (cb6930dae planner `dd`/`ud`, c4ab882b5 ask test `D`, card `IN` in
 * cbb2d9547), gated by GrowthBook `__gb__660676888` (c06cf64bb `hs`) AND the catalog ids
 * gxtx80/8r8477/1kk7ed1/11oncp/10bmqv1 being present in the runtime intl messages. On 2026-11-06 the live English
 * catalog had none of them, so upstream renders nothing. Unlike the other M6 gates this one is off locally: the
 * card's copy (ddl030/9l62tq/4nqed1/6uup1t) isn't shipped, and the card itself (feature T3) waits on it.
 */
export const SAFETY_NUDGES: boolean = false;

/** Upstream's `dd` threshold: the asks card rides on the call that brings the user-answered asks to 10. */
const ASKS_THRESHOLD = 10;

/**
 * Upstream `D` (c4ab882b5): a permission prompt the user answered by hand. Questions, plan exits and MCP calls
 * don't count, nor does anything a rule, mode, hook or classifier decided.
 */
export function countsAsUserAsk(call: ClientToolCall): boolean
{
	if (call.name === "AskUserQuestion" || call.name === "ExitPlanMode" || call.name.startsWith("mcp__")) return false;
	if (call.denied === true) return true;
	const permission = call.permission;
	return (
		permission !== undefined &&
		permission.reasonType === undefined &&
		(permission.source === "user_temporary" || permission.source === "user_reject")
	);
}

export interface AsksNudgeContext
{
	/** The session view can switch to Auto (upstream `autoSwitch !== null`). */
	autoOffered: boolean;
	/** An owned session whose nudge memory has loaded (upstream `C`). */
	owned: boolean;
	memory: NudgeMemory;
}

export interface AsksNudgePlan
{
	/** The tool call the card trails: the 10th user-answered ask. */
	carrierId: string;
	/** Every user-answered ask in the transcript, not just the first 10. */
	count: number;
}

/**
 * Upstream `dd` + `ud` for the asks fact: the card trails the 10th user-answered ask and counts them all. A
 * session shows one budgeted nudge kind at most, so a dismissed session or one that already showed another kind
 * gets nothing.
 */
export function planAsksNudge(
	calls: readonly ClientToolCall[],
	{autoOffered, owned, memory}: AsksNudgeContext,
): AsksNudgePlan | null
{
	if (!autoOffered || !owned || memory.dismissed === true) return null;
	if (memory.shown !== undefined && memory.shown !== "asks") return null;
	let count = 0;
	let carrierId: string | undefined;
	for (const call of calls)
	{
		if (!countsAsUserAsk(call)) continue;
		count++;
		if (count === ASKS_THRESHOLD) carrierId = call.id;
	}
	return carrierId === undefined
		? null
		:
			{
				carrierId,
				count,
			};
}
