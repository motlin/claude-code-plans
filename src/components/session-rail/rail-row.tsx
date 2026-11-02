import type {ReactNode} from "react";

/* Upstream's session rail card and row primitives, kept apart from the rail so pages reuse them without its dnd-kit chunk. */

/** Upstream's lined row: `min-h-list-row` 32px, the 10px `--rail-word-gap` and the 8px `--rail-row-pad`. */
const ROW_CLASS = "flex min-h-8 w-full min-w-0 items-center gap-2.5 rounded px-2 text-left text-[13px]/[19px]";

/** Rows that act get upstream's ghost hover, alpha press and focus ring. */
export const RAIL_ROW_ACTION_CLASS = `${ROW_CLASS} cursor-pointer hover:bg-fill-ghost-hover active:bg-alpha-2 hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus`;

/** Upstream's lined Environment folder and branch menu buttons: `h-list-row` 32px, padded row pad + 20px icon + word gap = 38px past the overlaid icon. */
export const ENVIRONMENT_MENU_BUTTON_CLASS =
	"flex h-8 w-full min-w-0 items-center justify-start gap-2.5 rounded ps-[38px] pe-2 text-left text-[13px]/[19px] cursor-pointer hover:bg-fill-ghost-hover active:bg-alpha-2 data-popup-open:bg-fill-ghost-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";

/** A row's slots: a 20px icon in text-secondary, the label, and a muted 12px trailing hint. */
export function RailRowContent({
	icon,
	label,
	hint,
	hintStatus,
}: {
	icon: ReactNode;
	label: ReactNode;
	hint?: ReactNode;
	/** Set when the hint is the event stream's state rather than a detail of the row. */
	hintStatus?: string;
})
{
	return (
		<>
			<span className="flex size-5 shrink-0 items-center justify-center text-secondary [&_svg]:size-4">
				{icon}
			</span>
			<span data-rail-row-label="" className="min-w-0 flex-1 truncate text-primary">
				{label}
			</span>
			{hint !== undefined && (
				<span
					data-rail-row-hint=""
					data-stream-status={hintStatus}
					className="shrink-0 text-[12px]/[15px] text-ink-muted tabular-nums"
				>
					{hint}
				</span>
			)}
		</>
	);
}

/** A row with nothing to do. */
export function RailRow(props: {
	icon: ReactNode;
	label: ReactNode;
	hint?: ReactNode;
	hintStatus?: string;
	title?: string;
})
{
	return (
		<div className={ROW_CLASS} title={props.title}>
			<RailRowContent {...props} />
		</div>
	);
}

/** Upstream's `data-rail-card` slot around each card; its radius follows `RAIL_CARD_CLASS`. Upstream's `contents has-[[data-rail-section]]:flex` only matters for empty slots, which never render here. */
export const RAIL_SLOT_CLASS = "relative flex flex-col rounded-r7";

/** Upstream's lined card (`epitaxy-rail-lined`): py-md 8px, pb-sm 6px while open, and the card ring, outset in light and inset in dark. */
export const RAIL_CARD_CLASS =
	"group/railcard epitaxy-rail-lined flex shrink-0 flex-col rounded-r7 pt-2 pb-2 data-open:pb-1.5 shadow-[0_0_0_1px_var(--color-border)] dark:shadow-[inset_0_0_0_1px_var(--color-border)]";
