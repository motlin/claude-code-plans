// Upstream cds MessageAttachments tile classes, shared by composer chips and sent-message tiles.

/** Upstream's cds MessageAttachments tile root: 120px, revealing its remove button on hover or focus. */
export const TILE_CLASS =
	"group/tile relative isolate size-[7.5rem] shrink-0 rounded-r7 outline-none focus-visible:shadow-focus";

/** Upstream's xs Card: an inset one-device-pixel border-strong ring that turns into the focus ring for a focused CardLink. */
export const CARD_CLASS =
	"group/card relative isolate flex flex-col rounded-card-xs after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:shadow-card-ring after:content-[''] has-[[data-cds=CardLink]:focus-visible]:after:shadow-focus size-full [--card-ring-color:var(--upstream-border-strong)] [--ring-inner:var(--sb-field-hairline)] [--ring-outer:0px]";

export const CARD_FILL_CLASS =
	"cds-card-fill pointer-events-none absolute inset-0 -z-[1] m-0 rounded-[inherit] bg-surface-3 shadow-field-drop";

export const CARD_BODY_CLASS = "cds-card-body flex min-h-0 flex-1 flex-col self-stretch rounded-[inherit] p-p7";

export const TILE_REMOVE_CLASS =
	"absolute -end-2 -top-2 z-[1] inline-flex size-5 cursor-pointer items-center justify-center rounded-full bg-surface-3 text-secondary shadow-card-ring hover:text-primary outline-none focus-visible:shadow-focus before:absolute before:-inset-0.5 before:content-[''] opacity-0 group-hover/tile:opacity-100 group-focus-visible/tile:opacity-100 group-has-[:focus-visible]/tile:opacity-100 touch:opacity-100";

/**
 * Upstream's xs Badge in an xs Card, with the fizzy outline-badge paint (9px radius, 1px transparent border, neutral
 * fill, 14px leading): the [data-size=xs] scope maps h-control-nested to 18px and pad-sm to 6px comfortable.
 */
export const BADGE_CLASS =
	"inline-flex h-control-nested min-w-0 max-w-full shrink-0 items-center gap-1 self-start whitespace-nowrap rounded-badge-outline border border-solid border-transparent bg-neutral px-sm align-middle font-sans text-caption font-medium leading-[round(1.25em,1px)] text-secondary";
