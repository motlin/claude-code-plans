import {useRef} from "react";
import {type ApprovalAnnouncement, useApprovalAnnouncement} from "../hooks/use-approval-announcement";

/**
 * Upstream's approval arrival region (cc970fefe): one persistent polite `span[role=status]` beside the approval slot,
 * mounted before any card so a screen reader hears each arriving card's announcement.
 */
export function ApprovalArrivalRegion(announcement: ApprovalAnnouncement)
{
	const regionRef = useRef<HTMLSpanElement>(null);
	useApprovalAnnouncement(regionRef, announcement);
	return (
		<span
			ref={regionRef}
			role="status"
			className="sr-only select-none"
			data-approval-arrival-region=""
			// Upstream mounts it with the transcript tail slot, which in-app Find skips.
			data-find-omitted=""
		/>
	);
}
