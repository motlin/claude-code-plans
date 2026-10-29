import {z} from "zod";

/** The permission mode the CLI's plan dialog offers to carry on in, besides asking for each edit. */
const PlanForwardModeSchema = z.enum(["acceptEdits", "auto", "bypassPermissions"]);
export type PlanForwardMode = z.infer<typeof PlanForwardModeSchema>;

/** Upstream's accept targets: a forward mode, or `default` for approving each edit by hand. */
const PlanAcceptModeSchema = z.enum([...PlanForwardModeSchema.options, "default"]);
export type PlanAcceptMode = z.infer<typeof PlanAcceptModeSchema>;

/** An answer to a pending ExitPlanMode: accept into a mode, or reject with optional feedback. */
export const PlanDecisionSchema = z.discriminatedUnion("kind", [
	z.strictObject({kind: z.literal("accept"), mode: PlanAcceptModeSchema}),
	z.strictObject({kind: z.literal("reject"), feedback: z.string()}),
]);
export type PlanDecision = z.infer<typeof PlanDecisionSchema>;

/** What the CLI's plan dialog on screen offers: its forward mode, if any, and whether it has a manual-approval row. */
export const PlanDialogSchema = z.strictObject({
	forwardMode: PlanForwardModeSchema.nullable(),
	manual: z.boolean(),
});
export type PlanDialog = z.infer<typeof PlanDialogSchema>;

/** Upstream's accept button labels, by target mode. */
export const PLAN_ACCEPT_LABEL: Record<PlanAcceptMode, string> = {
	default: "Accept",
	acceptEdits: "Accept and allow edits",
	auto: "Accept and auto mode",
	bypassPermissions: "Accept and bypass permissions",
};

/** Upstream's plan approval card copy. */
export const PLAN_REJECT_LABEL = "Reject";
export const PLAN_REVISE_OPEN_LABEL = "Revise…";
export const PLAN_REVISE_LABEL = "Revise";
export const PLAN_BACK_LABEL = "Back";
export const PLAN_FEEDBACK_LABEL = "Plan feedback";
export const PLAN_FEEDBACK_PLACEHOLDER = "What should change? (optional)";
/** The feedback placeholder while Plan pane comments will be sent along. */
export const PLAN_FEEDBACK_WITH_COMMENTS_PLACEHOLDER = "Anything else to add?";
export const PLAN_DELETE_COMMENT_LABEL = "Delete comment";

/** Upstream's screen-reader note under the card's comment list. */
export function planCommentCountLabel(count: number): string {
	return `${count} inline comment${count === 1 ? "" : "s"} will be sent`;
}

/** The card's primary accept target: the dialog's forward mode, else manual approval, else none. */
export function planPrimaryAccept(dialog: PlanDialog): PlanAcceptMode | null {
	return dialog.forwardMode ?? (dialog.manual ? "default" : null);
}

export type PlanKeyAction = {kind: "accept"; mode: PlanAcceptMode} | {kind: "revise"};

/**
 * Upstream's plan card keys while its feedback box is closed: ⌘⏎ accepts into
 * the primary mode, ⇧⌘⏎ accepts with manual approval, and Esc opens Revise.
 * A held key's repeats and keys an IME is composing do nothing.
 */
export function planKeyAction(
	event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey"> &
		Partial<Pick<KeyboardEvent, "repeat" | "isComposing">>,
	dialog: PlanDialog,
): PlanKeyAction | null {
	if (event.altKey || event.repeat === true || event.isComposing === true) return null;
	if (event.key === "Escape") return event.metaKey || event.ctrlKey || event.shiftKey ? null : {kind: "revise"};
	if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return null;
	if (event.shiftKey) return dialog.manual ? {kind: "accept", mode: "default"} : null;
	const primary = planPrimaryAccept(dialog);
	return primary === null ? null : {kind: "accept", mode: primary};
}
