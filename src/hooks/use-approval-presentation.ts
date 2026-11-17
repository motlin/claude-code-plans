import {useState} from "react";

import {nextApprovalPresentation, SHORT_VIEWPORT_QUERY, type ApprovalPresentation} from "../lib/approval-presentation";
import {useMediaQuery} from "../lib/use-phone-sheet";

/**
 * The approval cluster's presentation for its head card (`headId`, null with none pending): docked above the
 * composer on a viewport at most 420px tall, and kept docked for that card after the viewport grows. The server
 * snapshot is tall, so the first paint is inline, as upstream's (`t6`).
 */
export function useApprovalPresentation(headId: string | null): ApprovalPresentation
{
	const shortViewport = useMediaQuery(SHORT_VIEWPORT_QUERY);
	const [latchedId, setLatchedId] = useState<string | null>(null);
	const next = nextApprovalPresentation(
		{
			shortViewport,
			headId,
			latchedId,
		},
	);
	// Upstream sets the latch during render; React re-renders this component at once with the new state.
	if (next.latchedId !== latchedId) setLatchedId(next.latchedId);
	return next.presentation;
}
