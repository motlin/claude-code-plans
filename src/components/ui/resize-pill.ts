/** One cds ResizeHandle pill's class parts: picked by orientation and by dragging vs resting. */
export interface ResizePillParts
{
	base: string;
	vertical: string;
	horizontal: string;
	dragging: string;
	resting: string;
	focus: string;
}

/**
 * Upstream's panels line pill (shared-38 `IJ`): a full-length 2px `bg-fill-accent` line centred in
 * the handle that fades in 100ms after hover, stays lit while dragging, and goes 3px and rounded when
 * focus-visible. `duration-snap` is 120ms and `duration-base` 200ms.
 */
export const RESIZE_LINE_PILL: ResizePillParts =
{
	base: "absolute bg-fill-accent transition-opacity [--resize-line:2px]",
	vertical: "inset-y-0 start-[calc(50%_-_var(--resize-line)_/_2)] my-auto w-[var(--resize-line)]",
	horizontal: "inset-x-0 top-[calc(50%_-_var(--resize-line)_/_2)] mx-auto h-[var(--resize-line)]",
	dragging: "opacity-100 duration-[120ms]",
	resting: "opacity-[var(--cds-resize-pill-force,0)] delay-100 duration-200 group-hover/resize:opacity-100",
	focus: "group-focus-visible/resize:rounded-full group-focus-visible/resize:opacity-100 group-focus-visible/resize:delay-0 group-focus-visible/resize:[--resize-line:3px]",
};

/** Upstream's pre-panels grip pill (shared-38 `Tw`): a 3x48 muted capsule, accent and full length on focus. */
export const RESIZE_GRIP_PILL: ResizePillParts =
{
	base: "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current transition-[opacity,color,background-color]",
	vertical: "h-full max-h-12 w-[3px] group-focus-visible/resize:max-h-none",
	horizontal: "h-[3px] w-full max-w-12 group-focus-visible/resize:max-w-none",
	dragging: "text-secondary opacity-100 duration-[120ms]",
	resting:
		"text-ink-muted opacity-[var(--cds-resize-pill-force,0)] delay-200 duration-200 group-hover/resize:opacity-100",
	focus: "group-focus-visible/resize:bg-fill-accent group-focus-visible/resize:opacity-100 group-focus-visible/resize:delay-0",
};

/** The pill's class string for one orientation and drag state, in upstream's base/axis/state/focus order. */
export function resizePillClass(
	parts: ResizePillParts,
	orientation: "vertical" | "horizontal",
	dragging: boolean,
): string
{
	return [parts.base, parts[orientation], dragging ? parts.dragging : parts.resting, parts.focus].join(" ");
}

/**
 * Upstream's `Ai` on edge handles (the sidebar's `.dframe-resize-handle`, the file columns): at rest
 * the handle's inner 37.5% is clipped away so it never covers the panel's content, mirrored in RTL.
 */
export const RESIZE_HANDLE_HALF_CLIP_CLASS =
	"[clip-path:inset(0_0_0_37.5%)] [&:where(:root[dir=rtl]_:dir(rtl))]:[clip-path:inset(0_37.5%_0_0)] focus-visible:[clip-path:none]";
