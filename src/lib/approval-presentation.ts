/** Where a pending approval draws: inline after the transcript ("card") or above the composer ("dock"). */
export type ApprovalPresentation = "card" | "dock";

/** The head card the decision last resolved, and whether it docked (upstream's `{id, docked}` state). */
export interface ApprovalLatch
{
	id: string;
	docked: boolean;
}

/** Upstream's dock-by-kind trigger (c5da7eb42 `ab`): an MCP call's approval docks above the composer. */
const MCP_CALL_TOOL_USE_PREFIX = "toolu_mcp_call_";

/**
 * Upstream's dock decision (cb534450a `l`): a head docks when its tool use is an MCP call or when corner widgets
 * float beside the composer (cc43287c9 `WDe`; the local app has none yet, so `cornerWidgets` defaults false). The
 * decision latches per head card: a docked head stays docked, and a head that resolved inline moves down later only
 * when it `mayGoDown` (it is not an AskUserQuestion). With no head, only corner widgets dock.
 */
export function nextApprovalPresentation({
	headId,
	mayGoDown,
	cornerWidgets = false,
	latch,
}: {
	headId: string | null;
	mayGoDown: boolean;
	cornerWidgets?: boolean;
	latch: ApprovalLatch | null;
}):
{
	presentation: ApprovalPresentation;
	latch: ApprovalLatch | null;
}
{
	if (headId === null)
	{
		return {
			presentation: cornerWidgets ? "dock" : "card",
			latch,
		};
	}
	const docks = headId.startsWith(MCP_CALL_TOOL_USE_PREFIX) || cornerWidgets;
	const next =
		latch?.id === headId
			? !latch.docked && mayGoDown && docks
				?
					{
						id: headId,
						docked: true,
					}
				: latch
			:
				{
					id: headId,
					docked: docks,
				};
	return {
		presentation: next.docked ? "dock" : "card",
		latch: next,
	};
}
