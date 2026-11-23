import {useState} from "react";

import {nextApprovalPresentation, type ApprovalLatch, type ApprovalPresentation} from "../lib/approval-presentation";

/**
 * The approval cluster's presentation for its head card (`headId`, null with none pending): docked above the
 * composer for an MCP call's approval, else inline, latched per head card. `mayGoDown` is false for an
 * AskUserQuestion head, which never moves down once drawn inline.
 */
export function useApprovalPresentation(headId: string | null, mayGoDown: boolean): ApprovalPresentation
{
	const [latch, setLatch] = useState<ApprovalLatch | null>(null);
	const next = nextApprovalPresentation(
		{
			headId,
			mayGoDown,
			latch,
		},
	);
	// Upstream sets the latch during render; React re-renders this component at once with the new state.
	if (next.latch !== latch) setLatch(next.latch);
	return next.presentation;
}
