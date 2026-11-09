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

/**
 * Upstream re-inks the chin buttons' `--cds-text-secondary` to `--cds-fizzy-lake-color-control-ink` under fizzy color
 * (`text-secondary-control`: secondary with color off) at the control weight.
 */
const CHIN_BUTTON_CLASS =
	"flex h-6 min-w-0 items-center justify-center rounded-r4 leading-[20px] text-secondary-control font-control-regular transition-colors hover:bg-fill-ghost-hover hover:text-primary aria-expanded:bg-fill-ghost-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";

/** Upstream's footer pills: 24px tall at both densities, the radius 5px → 6px at comfortable. */
export const CHIN_TRIGGER_CLASS = `${CHIN_BUTTON_CLASS} truncate px-1.5 comfortable:rounded-r5`;

/**
 * The session chin's "pill" model trigger (`data-collapse="name"`): the name truncates first, down to 1.5rem, in a
 * baseline row that clips, and the effort tail is muted ink (upstream `text-muted`) that never hides.
 */
export const CHIN_MODEL_LABEL_CLASS = "flex min-w-0 items-baseline overflow-hidden";
export const CHIN_MODEL_NAME_CLASS = "min-w-6 truncate";
export const CHIN_EFFORT_LABEL_CLASS = "shrink-0 whitespace-pre text-ink-muted ms-1";

/**
 * The new-session bar's model trigger (upstream `renderTrigger`): a one-line name that keeps at least 10ch, and the
 * effort tail in `text-muted-as-secondary` (the muted ink, secondary under fizzy color).
 */
export const BAR_MODEL_LABEL_CLASS = "flex min-w-0 items-center gap-1";
export const BAR_MODEL_NAME_CLASS =
	"text-start whitespace-nowrap supports-[min-width:calc-size(auto,size)]:line-clamp-1 supports-[min-width:calc-size(auto,size)]:break-all supports-[min-width:calc-size(auto,size)]:whitespace-normal supports-[min-width:calc-size(auto,size)]:min-w-[calc-size(max-content,min(size,10ch))]";
export const BAR_EFFORT_LABEL_CLASS = "shrink-0 whitespace-pre text-muted-as-secondary";

/** Upstream's trailing chin group: the model, the mode and the ring in one max-content grid. */
export const CHIN_PICKERS_CLASS =
	"grid min-w-0 grid-flow-col auto-cols-[minmax(0,max-content)] items-center gap-1 compact:me-1";

/** The usage ring's wrapper (upstream `span.flex.shrink-0.ms-px`). */
export const USAGE_RING_WRAPPER_CLASS = "flex shrink-0 ms-px";

/** The usage ring's 24px square button. */
export const USAGE_RING_CLASS = `${CHIN_BUTTON_CLASS} aspect-square comfortable:rounded-r5`;

/** The card's 28px + button (pinned by `.epitaxy-prompt`), at upstream's 6px control radius, 8px at comfortable. */
export const ADD_BUTTON_CLASS = `group/btn ${CHIN_BUTTON_CLASS.replace("h-6", "size-7").replace("rounded-r4", "rounded-r5")} comfortable:rounded-r6`;

/** Upstream's chin icon ink (shared-33 `p`): control ink, primary on button hover, accent (local `text-upstream-accent`) while pressed. */
export const CHIN_ICON_INK_CLASS =
	"text-secondary-control group-hover/btn:text-primary group-aria-pressed/btn:text-upstream-accent group-hover/btn:group-aria-pressed/btn:text-upstream-accent";

/** The home composer's environment bar, which takes the chin's place under the card. */
export const ENVIRONMENT_BAR_CLASS = "@container flex w-full min-w-0 flex-col pt-0.5 -mb-0.5 md:pt-0 md:mb-0";

/** The bar's trailing pickers group: model, then permissions, then the ring, pushed to the end. */
export const ENVIRONMENT_PICKERS_CLASS = "flex grow items-center justify-end gap-x-1";

/** Each bar control's surface slot (upstream's `rounded bg-[var(--epitaxy-transcript-surface,var(--cds-surface-1))]`). */
export const ENVIRONMENT_SLOT_CLASS =
	"flex empty:hidden rounded bg-[var(--epitaxy-transcript-surface,var(--color-surface-1))]";

/**
 * The environment bar's row: the place controls, then the chin's mode, model and ring. Its pills stay 24px
 * tall, and their radius opens to upstream's comfortable 8px.
 */
export const ENVIRONMENT_BAR_ROW_CLASS =
	"flex min-h-6 items-center gap-x-1 gap-y-1.5 @max-[28.75rem]:flex-wrap px-2.5 text-[13px]/[20px] text-secondary [--cds-h-control:1.5rem] [--cds-pad-md:0.375rem] comfortable:[&_button]:rounded-r6";

/** Upstream's bar chip slot surface (`rounded ${w}`); the local surface token stands in for `--cds-surface-1`. */
const ENVIRONMENT_BAR_SLOT_CLASS = "rounded bg-[var(--epitaxy-transcript-surface,var(--color-surface-1))]";

/** The bar's chips group (place, worktree toggle), a line of its own when the bar is narrow. */
export const ENVIRONMENT_BAR_CHIPS_CLASS = "flex items-center gap-1 @max-[28.75rem]:basis-full";

/** The place chip's slot (`environment-bar-place`), which gives way before the others. */
export const ENVIRONMENT_BAR_PLACE_SLOT_CLASS = `flex shrink ${ENVIRONMENT_BAR_SLOT_CLASS}`;

/** The worktree toggle's slot, which never shrinks (upstream gives it no testid). */
export const ENVIRONMENT_BAR_WORKTREE_SLOT_CLASS = `flex shrink-0 ${ENVIRONMENT_BAR_SLOT_CLASS}`;

/** Upstream's environment-bar line (shared-33 `t5`), plus `text-danger` (blocking) or `text-muted-as-secondary`. */
export const ENVIRONMENT_BAR_LINE_CLASS = "pointer-events-none absolute inset-x-0 bottom-1.5 px-4 text-footnote";

/**
 * The line's zero-height host just above the home composer card (upstream `wT`). Local adaptation: the home dock
 * is not upstream's gapped flex column, so upstream's `-mb-1.5 compact:-mb-1.5 comfortable:-mb-2` (which cancels
 * the dock gap) would pull the card up here, and is left out.
 */
export const ENVIRONMENT_BAR_LINE_HOST_CLASS = "relative h-0";

/** The line's note span, when the custom-group note takes the line. */
export const ENVIRONMENT_BAR_NOTE_CLASS = "flex min-w-0 items-baseline gap-1.5 whitespace-nowrap";

/** Upstream's environment-bar place button: a 24px ghost control with a 16px icon, its label gap 8px at comfortable. */
export const PLACE_CHIP_CLASS =
	"flex h-6 max-w-[240px] min-w-0 items-center gap-1 comfortable:gap-2 rounded-r6 px-1.5 text-[13px]/[20px] text-secondary-control transition-colors hover:bg-fill-ghost-hover hover:text-primary hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";
