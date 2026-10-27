/** Upstream titlebar trail controls: 26px ghost squares with 18px icons in text-secondary that keep their ink on hover and squish when pressed. */
export const TITLEBAR_ICON_BUTTON_CLASS =
	"flex size-[26px] shrink-0 cursor-pointer items-center justify-center rounded-r5 text-secondary btn-squish hover:bg-fill-ghost-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus aria-pressed:bg-upstream-accent-pressed aria-pressed:text-upstream-accent [&_svg]:size-[18px]";

/** Upstream's rail toggle (session-presets gate) presses ghost-selected with primary ink instead of the accent blue. */
export const TITLEBAR_RAIL_TOGGLE_CLASS = TITLEBAR_ICON_BUTTON_CLASS.replace(
	"aria-pressed:bg-upstream-accent-pressed aria-pressed:text-upstream-accent",
	"aria-pressed:bg-fill-ghost-selected aria-pressed:text-primary",
);

/** Session chrome sits above its scrollport; sidebar clearance is relative to the tile inset. */
export const SESSION_STICKY_HEADER_CLASS =
	"relative z-10 shrink-0 bg-surface-2 pe-4 ps-[var(--tile-title-start,0px)] sm:pe-3";
