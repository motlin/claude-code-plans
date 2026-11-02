export const OPEN_DELAY_MS = 300;

export const SIDE_CLASS =
{
	top: "bottom-full left-1/2 mb-1 -translate-x-1/2",
	bottom: "top-full left-1/2 mt-1 -translate-x-1/2",
	right: "left-full top-1/2 ml-1 -translate-y-1/2",
	left: "right-full top-1/2 mr-1 -translate-y-1/2",
} as const;

/** The side classes for `align="start"`: flush with the anchor's start edge instead of centred on it. */
export const START_SIDE_CLASS =
{
	top: "bottom-full left-0 mb-1",
	bottom: "top-full left-0 mt-1",
	right: "left-full top-0 ml-1",
	left: "right-full top-0 mr-1",
} as const satisfies Record<keyof typeof SIDE_CLASS, string>;

/**
 * Upstream's 13px/18px tooltip box, shared with tooltips placed outside this component (the slash menu row tip).
 * `whitespace-normal` stands in for upstream's portal: a tip inside a `nowrap` row still wraps at 240px.
 */
export const TOOLTIP_CLASS =
	"pointer-events-none absolute z-50 inline-flex min-h-6 w-max max-w-[240px] items-center gap-2 rounded-r5 bg-[var(--tooltip-bg)] px-2 py-[3px] text-[13px]/[18px] text-[var(--tooltip-fg)] shadow-[0_1px_2px_rgb(11_11_11/0.06)] whitespace-normal";

/** The wider, wrapping box that keeps the content's line breaks. */
export const MULTILINE_TOOLTIP_CLASS = TOOLTIP_CLASS.replace("max-w-[240px]", "max-w-[320px]").replace(
	"whitespace-normal",
	"whitespace-pre-line",
);

/**
 * Upstream's rich two-line tooltip (the sidebar resize edge, Rewind, Fork): the 13px/18px label row on top,
 * an 11px/14px muted description below, wrapping within 240px.
 */
export const STACKED_TOOLTIP_CLASS = TOOLTIP_CLASS.replace(
	"inline-flex min-h-6 w-max max-w-[240px] items-center gap-2",
	"flex w-max max-w-[240px] flex-col items-start gap-0.5",
).replace("py-[3px]", "py-1.5");

/**
 * Upstream's Send tooltip with a second action on the control: one label + shortcut row per action, stacked with
 * a 2px gap inside 6px 8px padding and no width cap.
 */
export const ACTION_ROWS_TOOLTIP_CLASS = TOOLTIP_CLASS.replace(
	"inline-flex min-h-6 w-max max-w-[240px] items-center gap-2",
	"flex w-max flex-col items-start gap-0.5",
).replace("py-[3px]", "py-1.5");

/**
 * Upstream's disabled-reason box (cds `DisabledReasonTooltip`, multiline): a wrap within 240px with 6px 8px
 * padding, balanced by the Tooltip's shortcut-less `text-balance`.
 */
export const REASON_TOOLTIP_CLASS = TOOLTIP_CLASS.replace(
	"inline-flex min-h-6 w-max max-w-[240px] items-center gap-2",
	"flex w-max max-w-[240px] flex-col gap-0.5",
).replace("py-[3px]", "py-1.5");

/**
 * Upstream's Home next-step row tooltip (cds Tooltip with a detail): the title over its 11px/14px detail,
 * wrapping within min(480px, the viewport less 8px each side).
 */
export const STACKED_DETAIL_TOOLTIP_CLASS = TOOLTIP_CLASS.replace(
	"inline-flex min-h-6 w-max max-w-[240px] items-center gap-2",
	"flex w-max max-w-[min(480px,calc(100vw-16px))] flex-col gap-0.5",
).replace("py-[3px]", "py-1.5");
