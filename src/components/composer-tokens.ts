/**
 * The composer's class tokens, kept in a module of their own so the hard-load fallback
 * (app-shell-fallback.tsx) paints the same boxes without pulling the composer into the shell bundle.
 */

/** The prompt card. */
export const COMPOSER_CARD_CLASS =
	"relative z-[1] flex cursor-text flex-col gap-y-1.5 comfortable:gap-y-2 rounded-composer bg-surface-3 p-2 shadow-[var(--composer-shadow-idle)] transition-shadow focus-within:shadow-[var(--composer-shadow-focus)]";

/**
 * The editor row: the text clears the absolute 28px Add and Send by upstream's cluster gap (6px; 8px at
 * comfortable, `compact:pe-1.5 comfortable:pe-2` / `ps-2`), counting the editor's own 4px start pad.
 */
export const COMPOSER_EDITOR_ROW_CLASS = "relative pr-[30px] pl-[30px] comfortable:pr-[32px] comfortable:pl-[32px]";

/** The chin row under the card. */
export const COMPOSER_CHIN_CLASS =
	"@container mt-1.5 flex min-h-6 items-center justify-between ps-[7px] pe-2.5 text-[13px]/[20px] text-secondary";

const CHIN_BUTTON_CLASS =
	"flex h-6 min-w-0 items-center justify-center rounded-r4 leading-[20px] text-secondary transition-colors hover:bg-fill-ghost-hover hover:text-primary aria-expanded:bg-fill-ghost-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";

/** Upstream's footer pills: 24px tall at both densities, the radius 5px → 6px at comfortable. */
export const CHIN_TRIGGER_CLASS = `${CHIN_BUTTON_CLASS} truncate px-1.5 comfortable:rounded-r5`;

/**
 * Upstream mutes the effort (`text-muted-as-secondary`, which falls back to the muted ink) and drops it when the
 * chin is under 280px.
 */
export const EFFORT_LABEL_CLASS = "shrink-0 whitespace-pre text-ink-muted @max-[280px]:hidden";

/** The usage ring's 24px square button. */
export const USAGE_RING_CLASS = `${CHIN_BUTTON_CLASS} aspect-square comfortable:rounded-r5`;

/** The card's 28px + button (pinned by `.epitaxy-prompt`), at upstream's 6px control radius, 8px at comfortable. */
export const ADD_BUTTON_CLASS = `${CHIN_BUTTON_CLASS.replace("h-6", "size-7").replace("rounded-r4", "rounded-r5")} comfortable:rounded-r6`;

/** The home composer's environment bar, which takes the chin's place under the card. */
export const ENVIRONMENT_BAR_CLASS = "@container pt-1 comfortable:pt-0.5";

/**
 * The environment bar's row: the place controls, then the chin's mode, model and ring. Its pills stay 24px
 * tall, and their radius opens to upstream's comfortable 8px.
 */
export const ENVIRONMENT_BAR_ROW_CLASS =
	"flex min-h-6 items-center gap-x-1 gap-y-1.5 @max-[28.75rem]:flex-wrap px-2.5 text-[13px]/[20px] text-secondary [--cds-h-control:1.5rem] comfortable:[&_button]:rounded-r6";

/** The place controls' slot, a line of its own when the bar is narrow. */
export const ENVIRONMENT_PLACE_CLASS = "flex min-w-0 items-center @max-[28.75rem]:basis-full";

/** Upstream's environment-bar place button: a 24px ghost control with a 16px icon, its label gap 8px at comfortable. */
export const PLACE_CHIP_CLASS =
	"flex h-6 max-w-[240px] min-w-0 items-center gap-1 comfortable:gap-2 rounded-r6 px-1.5 text-[13px]/[20px] text-secondary transition-colors hover:bg-fill-ghost-hover hover:text-primary hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";
