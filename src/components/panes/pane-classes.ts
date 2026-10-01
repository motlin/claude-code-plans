/**
 * Upstream pane header icon buttons: 24px ghost squares in primary ink with the 5% ghost hover fill.
 * A pressed toggle (aria-pressed=true) keeps a transparent background and turns its icon accent ink.
 */
export const PANE_HEADER_ICON_BUTTON_CLASS =
	"flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-r5 text-primary transition-colors hover:bg-fill-ghost-hover aria-pressed:bg-transparent aria-pressed:text-upstream-accent";
