/** Upstream's `FC`: the popup list's gutter, around the scroller. */
export const POPUP_LIST_GUTTER_CLASS = "flex min-h-0 flex-1 flex-col overflow-hidden rounded-[inherit] p-1";
/** Upstream's `wI`: the popup list's scroller, which owns the scroll-fade-y edge fade. */
export const POPUP_LIST_SCROLL_CLASS =
	"min-h-0 flex-1 overflow-y-auto overflow-x-hidden scroll-fade-y outline-none focus-visible:outline-hidden max-h-[var(--cds-popup-list-max-h,none)]";
/** The listbox itself: no overflow and no padding of its own. */
export const POPUP_LISTBOX_CLASS = "outline-none focus-visible:outline-hidden";
