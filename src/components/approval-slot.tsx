import {useCallback, type ReactNode} from "react";

import {focusComposer, getComposerText} from "../lib/context-attach";
import type {ApprovalSlotCard} from "../lib/approval-slot-card";
import {useApprovalSlot} from "../lib/approval-slot-landing";

/**
 * Upstream's approval slot: a `display: contents` wrapper whose card, when it leaves while it held keyboard
 * focus, hands focus to the slot's next card or to the session composer (with a composer draft, always the
 * composer).
 */
export function ApprovalSlot({
	sessionId,
	card,
	takesFocus,
	chordActsAnywhere,
	children,
}: ApprovalSlotCard &
{
	sessionId: string;
	children: ReactNode;
})
{
	const hasDraft = useCallback(() => (getComposerText(sessionId) ?? "") !== "", [sessionId]);
	const toComposer = useCallback(() =>
	{
		focusComposer(sessionId);
	}, [sessionId]);
	const {setSlot, watch} = useApprovalSlot(
		{
			card,
			takesFocus,
			hasDraft,
			chordActsAnywhere,
			toComposer,
		},
	);
	return (
		<>
			<div
				ref={setSlot}
				style={
				{
					display: "contents",
				}}
				data-approval-slot=""
			>
				{children}
			</div>
			{watch}
		</>
	);
}
