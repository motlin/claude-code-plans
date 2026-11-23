import type React from "react";

/**
 * Upstream shared-frame `qe`: a TurnStatus row stretches across its column and pads by pad-xs, while its
 * margins pull that padding back out so the label sits on the AssistantMessage text inset and the row ends
 * at its text stop. `--cds-turn-status-hang` is dormant upstream (no caller passes `hangMark`).
 */
export const TURN_STATUS_ROW_GEOMETRY =
	"w-stretch px-xs ms-[calc(var(--cds-assistant-message-text-inset,0px)_-_var(--cds-outset-x,0px)_-_var(--cds-turn-status-hang,0px))] me-[calc(var(--cds-assistant-message-text-stop,0px)_-_var(--cds-outset-x,0px))]";

/** Upstream shared-frame `JG`: the outset the row geometry's margins subtract. */
export const TURN_STATUS_ROW_STYLE =
{
	"--cds-outset-x": "var(--cds-pad-xs)",
} as React.CSSProperties;

/**
 * Upstream shared-frame `gr`: a row pads its line box out to the control height, so it stands 24px at
 * compact, 32px at comfortable and 28px at comfortable under fizzy panels on a fine pointer.
 */
export const TURN_STATUS_ROW_PAD_Y = "py-[calc((var(--cds-h-control)_-_1lh)_/_2)]";

/** Upstream `IO`: a marked (busy) row eases a change of its start margin. */
export const TURN_STATUS_ROW_MARKED_MOTION =
	"transition-[margin-inline-start] duration-200 ease-out motion-reduce:transition-none";

/**
 * Upstream `gR`/`rf`'s TurnStatus row keyboard ring: a 1px inset --cds-fill-accent hairline in the density radius
 * (`rounded`: 6px compact, 8px comfortable). Upstream paints it on a stretched toggle's `::after`; a local row is its
 * own toggle, so the same pixels go on the row. Under forced colors the transparent outline shows 2px inside the row,
 * where upstream's `[data-cds-row-toggle]:focus-visible:after` outline sits.
 */
export const TURN_STATUS_ROW_FOCUS_RING =
	"rounded outline-none hide-focus-ring focus-visible:outline-hidden focus-visible:outline-offset-[-2px] focus-visible:[box-shadow:inset_0_0_0_1px_var(--cds-fill-accent)]";

/** The ring fading over upstream's --cds-dur-fast (60ms). A marked row's margin ease owns `transition` instead. */
export const TURN_STATUS_ROW_FOCUS = `${TURN_STATUS_ROW_FOCUS_RING} transition-shadow duration-fast`;

/** Upstream shared-9 `Cd`'s outer div: the open body sits 6px below its row and pads 4px under its card (8/6 comfortable). */
export const TURN_STATUS_PANEL_CLASS = "pt-sm pb-xs";

/**
 * Upstream `Cd` while its row leaves the marked state: the indent slides back to 0 over the mark slot's 400ms collapse,
 * on the same easing, and snaps under reduced motion.
 */
export const TURN_STATUS_PANEL_LEAVING_CLASS =
	"ps-0 transition-[padding-inline-start] duration-[400ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none";

/** Upstream `zR`: a marked row's body starts under its label, past the 20px mark and its 12px gap. */
export const TURN_STATUS_MARKED_PANEL_STYLE: React.CSSProperties =
{
	paddingInlineStart: "calc(var(--cds-assistant-message-text-inset,0px) + 20px + 12px)",
};

/** Upstream `Cd`'s card: one hairline-ringed card whose cells are divided, resetting the text inset for its rows. */
export const TURN_STATUS_CARD_CLASS =
	"[--cds-assistant-message-text-inset:0px] [--cds-assistant-message-text-stop:0px] flex min-w-0 flex-col divide-y overflow-y-clip rounded-card shadow-card-ring";

/**
 * Upstream `hm`, the cell `uZ` wraps each step in, applied to the card's children: a step list can render nothing
 * (an empty notice run) and a wrapper would leave an empty padded cell behind.
 */
export const TURN_STATUS_CELLS_CLASS =
	"[&>*]:min-w-0 [&>*]:px-[var(--cds-turn-status-card-pad-x,var(--cds-pad-md))] [&>*]:py-sm [&>*]:[--cds-assistant-message-text-inset:0px] [&>*]:[--cds-assistant-message-text-stop:0px]";
