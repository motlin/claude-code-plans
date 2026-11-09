import type {PermissionDialogShape} from "./herdr/permission-screen";

/** The drawn card's slot config, as upstream's dock (`tS`) builds it. */
export interface ApprovalSlotCard {
	card: string | undefined;
	takesFocus: boolean;
	chordActsAnywhere: boolean;
}

/**
 * The session's trailing approval slot draws the permission card, then the plan card, then the hook question card;
 * the first one drawn is the slot's card. A deny-first (or still-unknown) permission dialog draws upstream's
 * defaultToNo card, which doesn't take focus; a plan's ⇧⌘⏎ still acts after a landing.
 */
export function sessionApprovalSlotCard({
	permission,
	planId,
	questionId,
}: {
	permission: {key: string; dialog: PermissionDialogShape | "unknown" | undefined} | null;
	planId: string | null;
	questionId: string | null;
}): ApprovalSlotCard {
	if (permission !== null) {
		const denyFirst = permission.dialog === "unknown" || permission.dialog?.denyFirst === true;
		return {card: `permission:${permission.key}`, takesFocus: !denyFirst, chordActsAnywhere: false};
	}
	if (planId !== null) return {card: `plan:${planId}`, takesFocus: true, chordActsAnywhere: true};
	if (questionId !== null)
		return {card: `ask_user_question:${questionId}`, takesFocus: true, chordActsAnywhere: false};
	return {card: undefined, takesFocus: false, chordActsAnywhere: false};
}
