/** Upstream titlebar trail controls: 26px ghost squares with 18px icons in text-secondary that keep their ink on hover. */
export const TITLEBAR_ICON_BUTTON_CLASS =
	"flex size-[26px] shrink-0 cursor-pointer items-center justify-center rounded-r5 text-secondary transition-colors hover:bg-fill-ghost-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-100 aria-pressed:bg-upstream-accent-pressed aria-pressed:text-upstream-accent [&_svg]:size-[18px]";

/**
 * The session page's sticky header around the titlebar: no bottom border or padding, so the bar
 * is exactly upstream's 32px. The clearance vars keep it clear of the sidebar toggle.
 */
export const SESSION_STICKY_HEADER_CLASS =
	"sticky top-0 z-10 bg-surface-2 pt-[var(--top-left-clearance-top,0px)] -mx-4 pe-4 ps-[max(1rem,var(--top-left-clearance-start,0px))] sm:-mx-8 sm:pe-8 sm:ps-[max(2rem,var(--top-left-clearance-start,0px))]";
