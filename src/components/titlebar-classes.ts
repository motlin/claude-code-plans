/**
 * Upstream's titlebar trail controls, ghost icon-only cds Buttons: the control-token square (24px default, 28px
 * comfortable on a fine pointer under panels, 32px comfortable otherwise) at the density radius, primary ink,
 * ghost-selected with primary ink when pressed, and a squish on press. Under fizzy-lake `color` the paint is the
 * ghost-button hover for hover and press alike, and only the ink transitions.
 */
export const TITLEBAR_ICON_BUTTON_CLASS =
	"flex size-[var(--cds-h-control)] shrink-0 cursor-pointer items-center justify-center rounded-[var(--upstream-radius)] text-primary btn-squish stacks:[--btn-squish-paint:color_60ms_cubic-bezier(0.165,0.84,0.44,1)] hover:bg-fill-ghost-hover aria-pressed:bg-fill-ghost-selected aria-pressed:text-primary stacks:hover:bg-fill-button-ghost-hover stacks:aria-pressed:bg-fill-button-ghost-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";

/** Session chrome sits above its scrollport; sidebar clearance is relative to the tile inset. */
export const SESSION_STICKY_HEADER_CLASS =
	"relative z-10 shrink-0 bg-surface-2 pe-4 ps-[var(--tile-title-start,0px)] sm:pe-3";

/** The session titlebar lifted into the wide title row keeps the sticky header's inline insets. */
export const SESSION_LIFTED_HEADER_CLASS = "pe-4 ps-[var(--tile-title-start,0px)] sm:pe-3";
