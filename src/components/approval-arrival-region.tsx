import {useRef} from "react";
import {type ApprovalAnnouncement, useApprovalAnnouncement} from "../hooks/use-approval-announcement";

/**
 * Upstream's approval arrival region (cc970fefe): one persistent polite `span[role=status]` in the approval cluster column, just before the card slot,
 * mounted before any card (its transcript-trailing-slot ancestor keeps in-app Find out) so a screen reader hears each arriving card's announcement.
 */
export function ApprovalArrivalRegion(announcement: ApprovalAnnouncement)
{
	const regionRef = useRef<HTMLSpanElement>(null);
	useApprovalAnnouncement(regionRef, announcement);
	return <span ref={regionRef} role="status" className="sr-only select-none" data-approval-arrival-region="" />;
}
