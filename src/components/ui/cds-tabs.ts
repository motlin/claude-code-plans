/**
 * Upstream's cds `Tabs` tab recipe at comfortable density (`h-control` 28, `px-md` 12, r8 pill on `::before`,
 * inset-x 1px), shared by the Customize section tabs, the Artifacts view tabs and the Settings phone strip.
 * Local `font-control` is upstream's `font-medium font-control` (500, 435 under fizzy-lake `type`). Under
 * fizzy-lake `color`, globals.css re-points the muted/secondary ink at control-ink (text-primary) and paints the
 * `[data-active]` pill ghost-selected; the wrapping element must carry `data-cds="Tabs"`.
 */
export const CDS_TAB_CLASS =
	"relative isolate inline-flex h-7 shrink-0 items-center justify-center gap-1.5 px-3 text-body font-control whitespace-nowrap text-ink-muted no-underline outline-none select-none before:absolute before:inset-x-px before:inset-y-0 before:-z-[1] before:rounded-r6 before:transition-shadow before:duration-[60ms] focus-visible:outline-hidden focus-visible:before:shadow-focus data-[active]:text-primary data-[active]:before:bg-fill-ghost-hover [&:not([data-active])]:hover:text-secondary [&:not([data-active])]:hover:before:bg-fill-ghost-hover";

/** Upstream's cds Tabs list: abutting tabs whose first/last pills run to the strip's edges. */
export const CDS_TAB_LIST_CLASS =
	"flex items-center font-sans [&>[role=tab]:first-child]:before:start-0 [&>[role=tab]:last-child]:before:end-0";
