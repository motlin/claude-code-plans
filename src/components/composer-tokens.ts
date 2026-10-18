/**
 * The composer's class tokens, kept in a module of their own so the hard-load fallback
 * (app-shell-fallback.tsx) paints the same boxes without pulling the composer into the shell bundle.
 */

/** The prompt card. */
export const COMPOSER_CARD_CLASS =
	"relative z-[1] flex cursor-text flex-col gap-y-1.5 rounded-composer bg-surface-3 p-2 shadow-[var(--composer-shadow-idle)] transition-shadow focus-within:shadow-[var(--composer-shadow-focus)]";

/** The chin row under the card. */
export const COMPOSER_CHIN_CLASS =
	"@container mt-1.5 flex min-h-6 items-center justify-between ps-[7px] pe-2.5 text-[13px]/[20px] text-secondary";

const CHIN_BUTTON_CLASS =
	"flex h-6 min-w-0 items-center justify-center rounded-r4 leading-[20px] text-secondary transition-colors hover:bg-fill-ghost-hover hover:text-primary focus-visible:shadow-[0_0_0_2px_var(--accent-100)] focus-visible:outline-none";

export const CHIN_TRIGGER_CLASS = `${CHIN_BUTTON_CLASS} truncate px-1.5`;

/** Upstream reads the model and effort in primary ink; +, mode and usage stay secondary. */
export const CHIN_PRIMARY_TRIGGER_CLASS = CHIN_TRIGGER_CLASS.replace("text-secondary", "text-primary");

/** Upstream mutes the effort and drops it when the chin is under 280px. */
export const EFFORT_LABEL_CLASS = "shrink-0 whitespace-pre text-ink-muted @max-[280px]:hidden";

/** The usage ring's 24px square button. */
export const USAGE_RING_CLASS = `${CHIN_BUTTON_CLASS} aspect-square`;

/** The card's 28px + button. */
export const ADD_BUTTON_CLASS = CHIN_BUTTON_CLASS.replace("h-6", "size-7");
