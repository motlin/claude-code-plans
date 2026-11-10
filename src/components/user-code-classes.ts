/**
 * Upstream's plain user code chip (`V` in c8a6d9da5). Upstream's `border-0.5` takes its global default border
 * color (`--cds-border`); local has no global default, so `border-border` names it.
 */
export const USER_CODE_CLASS =
	"text-code leading-none text-danger bg-alpha-1 border-0.5 border-border rounded-[0.4em] px-[0.25em] py-[0.0625em] [overflow-wrap:anywhere]";

/**
 * Upstream `Er`'s class merged with the code-chip link class `H`: tailwind-merge
 * drops `Er`'s `inline-block` for `H`'s `inline`.
 */
export const USER_LINK_CLASS =
	"aria-busy:cursor-progress aria-busy:opacity-60 inline text-code leading-none text-danger bg-alpha-1 border-0.5 border-border rounded-[0.4em] px-[0.25em] py-[0.0625em] [overflow-wrap:anywhere] hover:bg-alpha-2 underline underline-offset-[3px] decoration-[color-mix(in_srgb,currentColor,transparent_60%)] hover:decoration-current focus-visible:outline-hidden hide-focus-ring focus-visible:shadow-focus";

/** Upstream `Br`'s cds disabled-reason wrapper class around a blocked ref. */
export const BLOCKED_WRAPPER_CLASS = "inline rounded-sm focus-visible:outline-hidden focus-visible:shadow-focus";
