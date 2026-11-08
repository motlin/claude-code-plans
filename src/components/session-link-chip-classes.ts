/*
 * Upstream claude.ai/code's shared session link chip classes (cb8c5a88f `on`/`sn`/`cn`/`ln`/`fn`/`mn`),
 * with upstream's `bg-accent-muted`/`text-accent`/`bg-accent` mapped to the local upstream tokens.
 * The `epitaxy-link-chip` hook is shared with the file chips.
 */

/** Upstream `on`: the pill every chip variant starts from. */
export const CHIP_BASE =
	"epitaxy-link-chip inline-flex max-w-full items-center rounded-sm bg-upstream-accent-muted px-1.5 align-baseline leading-tight";

/** Upstream `sn`: the accent-text chip. */
export const CHIP_TEXT = `${CHIP_BASE} text-upstream-accent no-underline`;

/** Upstream `cn`: the interactive chip (link or button), with the hover fill and focus shadow. */
export const CHIP_INTERACTIVE = `${CHIP_TEXT} hover:bg-upstream-accent-pressed data-[menu-open]:bg-upstream-accent-pressed focus-visible:outline-hidden hide-focus-ring focus-visible:shadow-focus`;

/** Upstream `fn`: the chip with no handler, so no hover fill and no focus ring. */
export const CHIP_STATIC = `${CHIP_TEXT} data-[menu-open]:bg-upstream-accent-pressed`;

/** Upstream `mn`: the muted chip while its message is still being written. */
export const CHIP_MUTED = `${CHIP_BASE} text-muted-as-secondary no-underline`;

/** Upstream's label wrapper when the chip knows its session row or status. */
export const CHIP_LABEL = "self-baseline truncate";
