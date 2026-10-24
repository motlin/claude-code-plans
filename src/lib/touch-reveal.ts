/**
 * Reveals a hover-only control on touch: coarse pointers and devices without hover never fire the
 * `group-hover` that shows it. Append to any control hidden behind `opacity-0` until hover, as
 * upstream's tool-row trail does.
 */
export const TOUCH_REVEAL =
	"pointer-coarse:opacity-100 pointer-coarse:pointer-events-auto [@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto";

/**
 * Grows a tiny (12-14px) control's tap target to 44px on touch with an `::after` overlay centered on
 * it, as upstream's `.touch` rule. Larger controls get a zero inset, so the overlay never shrinks them.
 */
export const TOUCH_HIT =
	"relative pointer-coarse:after:absolute pointer-coarse:after:-inset-[max(0px,calc((2.75rem-100%)/2))] [@media(hover:none)]:after:absolute [@media(hover:none)]:after:-inset-[max(0px,calc((2.75rem-100%)/2))]";
