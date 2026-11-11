/*
 * Upstream's cds Button disabled look (`kl` + `aD`, `b2`), shared by the hand-copied local cds Buttons.
 * By default a disabled, non-busy button dims to opacity .4; under fizzy colour (`stacks:`) it keeps opacity 1
 * and takes the disabled ink, with the shortcut caps following it. Pointer events are off either way.
 */
export const CDS_BUTTON_DISABLED =
	"[&:disabled:not([aria-busy])]:opacity-disabled disabled:pointer-events-none stacks:[&:disabled:not([aria-busy])]:opacity-100 stacks:[&:disabled:not([aria-busy])]:text-button-disabled stacks:[&:disabled:not([aria-busy])]:[--shortcut-cap-ink:currentColor]";

/** Upstream `b2`: an icon-only button outside a SplitDropdownButton uses the dimmer icon-only disabled ink. */
export const CDS_ICON_ONLY_DISABLED =
	"stacks:[&:disabled:not([aria-busy])]:not-in-data-[cds=SplitDropdownButton]:[--upstream-text-button-disabled:var(--upstream-icon-only-disabled)]";

/** Upstream's filled-variant disabled paint (`stacks:…bg-fill-disabled`), for a button that paints itself. */
export const CDS_BUTTON_DISABLED_FILL = "stacks:[&:disabled:not([aria-busy])]:bg-fill-disabled";

/** Upstream `CL`: a ghost paint layer stays transparent while its button is disabled. */
export const CDS_GHOST_PAINT_DISABLED = "stacks:group-[:disabled:not([aria-busy])]/btn:bg-transparent";
