/*
 * Upstream's cds ResizeHandle pill (shared-38 `_G`), picked by `i9("panels") ? IJ : Tw`.
 * Under the fizzy-lake `panels` part it is a full-length 2px `bg-fill-accent` line centred in
 * the handle that fades in 100ms after hover, and goes 3px and rounded when focus-visible.
 */
export const RESIZE_LINE_PILL_CLASS =
	"absolute inset-y-0 start-[calc(50%_-_var(--resize-line)_/_2)] my-auto w-[var(--resize-line)] bg-fill-accent opacity-0 transition-opacity delay-100 duration-200 [--resize-line:2px] group-hover/resize:opacity-100 group-focus-visible/resize:rounded-full group-focus-visible/resize:opacity-100 group-focus-visible/resize:delay-0 group-focus-visible/resize:[--resize-line:3px]";
