/** Upstream titlebar trail controls: 26px ghost squares with 18px icons in text-secondary that keep their ink on hover. */
export const TITLEBAR_ICON_BUTTON_CLASS =
	"flex size-[26px] shrink-0 cursor-pointer items-center justify-center rounded-r5 text-secondary transition-colors hover:bg-fill-ghost-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-100 aria-pressed:bg-upstream-accent-pressed aria-pressed:text-upstream-accent [&_svg]:size-[18px]";

/** Session chrome sits above its scrollport; sidebar clearance is relative to the tile inset. */
export const SESSION_STICKY_HEADER_CLASS =
	"relative z-10 shrink-0 bg-page dark:bg-surface-2 pe-4 ps-[var(--tile-title-start,0px)] sm:pe-3";
