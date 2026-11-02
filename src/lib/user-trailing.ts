/**
 * Upstream's user trailing strip (`div[data-user-trailing]`, shared-80 `p8`) and the
 * `reservesActionsGap` presentation gates that mark it, or an assistant message, with
 * `data-reserves-actions-gap` so the `[data-transcript-row]` gets its `pb-md` band (shared-60 `Ll`).
 */

/** Upstream's strip class, copied verbatim; the side class and optional after-frame margin follow it. */
export const USER_TRAILING_CLASS =
	"flex w-full flex-col gap-5 compact:gap-4 print:block print:[&>:where(:not(:first-child))]:!mt-5 compact:print:[&>:where(:not(:first-child))]:!mt-4 empty:hidden [&>*]:!my-0";

/** Upstream `uT`: `start` only for `authorLayout` "other" authors, which Code never has. */
export const USER_TRAILING_SIDE_CLASS =
{
	end: "items-end",
	start: "items-start",
} as const;

/** Appended to the strip when the user frame above it renders tiles, a bubble, a failed footer or actions. */
export const USER_TRAILING_AFTER_FRAME_CLASS = "mt-5 compact:mt-4";

/** Upstream shared-60 `py`. */
export const RESERVES_ACTIONS_GAP_ATTR = "data-reserves-actions-gap";

/** The presentation option's value (shared-38 `Xd` defaults it to `false`). */
export type ReservesActionsGap = boolean | "prompts";

/** Claude Code's `code-core` presentation sets `reservesActionsGap: "prompts"`; the chat hub sets `true`. */
export const CODE_RESERVES_ACTIONS_GAP: ReservesActionsGap = "prompts";

export type TranscriptRowPosition = "only" | "first" | "middle" | "last";

export interface UserActionsGapInput
{
	reservesActionsGap: ReservesActionsGap;
	position: TranscriptRowPosition;
	/** `annotations.chat.awaitingTurn` (upstream `ao`). */
	awaiting: string | undefined;
	/** `annotations.chat.insideReply === true` (upstream `bD`). */
	insideReply: boolean;
	/** How many items land after the frame (upstream `Mt(items).after.length`). */
	trailingCount: number;
}

/** shared-80 `p8` `Re`: `reservesActionsGap!==!1 && v && Pe!=="stacked" && !bD(t) && A.length>0`. */
export function reservesUserActionsGap({
	reservesActionsGap,
	position,
	awaiting,
	insideReply,
	trailingCount,
}: UserActionsGapInput): boolean
{
	return (
		reservesActionsGap !== false &&
		(position === "only" || position === "last") &&
		awaiting !== "stacked" &&
		!insideReply &&
		trailingCount > 0
	);
}

/** shared-80 `Hj`'s first term, `reservesActionsGap===!0`: Code's `"prompts"` never marks an assistant message. */
export function reservesAssistantActionsGap(reservesActionsGap: ReservesActionsGap): boolean
{
	return reservesActionsGap === true;
}
