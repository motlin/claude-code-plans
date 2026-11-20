import type {ReactNode} from "react";

import type {ShowMoreState} from "./use-show-more";

/* Upstream's session rail card and row primitives, kept apart from the rail so pages reuse them without its dnd-kit chunk. */

/** Upstream's lined row: `min-h-list-row` 32px, the 10px `--rail-word-gap` and the 8px `--rail-row-pad`. */
const ROW_CLASS = "flex min-h-8 w-full min-w-0 items-center gap-2.5 rounded px-2 text-left text-body";

/** Rows that act get upstream's ghost hover, alpha press and focus ring. */
export const RAIL_ROW_ACTION_CLASS = `${ROW_CLASS} cursor-pointer hover:bg-fill-ghost-hover active:bg-alpha-2 hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus`;

/** Upstream's lined Environment folder and branch menu buttons: `h-list-row` 32px, padded row pad + 20px icon + word gap = 38px past the overlaid icon. */
export const ENVIRONMENT_MENU_BUTTON_CLASS =
	"flex h-8 w-full min-w-0 items-center justify-start gap-2.5 rounded ps-[38px] pe-2 text-left text-body cursor-pointer hover:bg-fill-ghost-hover active:bg-alpha-2 data-popup-open:bg-fill-ghost-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";

/** Upstream's trailing state spans (Connectors' "Off" and "Authenticate"): a footnote without tabular digits. */
const HINT_TONE_CLASS =
{
	muted: "shrink-0 text-footnote text-ink-muted",
	warning: "shrink-0 text-footnote text-warning",
} as const;

/** A row's slots: a 20px icon in text-secondary, the label, and a muted 12px trailing hint. */
export function RailRowContent({
	icon,
	label,
	hint,
	hintStatus,
	hintTone,
}: {
	icon: ReactNode;
	label: ReactNode;
	hint?: ReactNode;
	/** Set when the hint is the event stream's state rather than a detail of the row. */
	hintStatus?: string;
	/** Set for a state label rather than a detail: upstream's footnote span in that tone. */
	hintTone?: keyof typeof HINT_TONE_CLASS;
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
					className={
						hintTone === undefined
							? "shrink-0 text-[12px]/[15px] text-ink-muted tabular-nums"
							: HINT_TONE_CLASS[hintTone]
					}
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

/** Upstream's flat-rail chrome (shared-18 `bX`): inside a `[data-session-rail-flat]` ancestor, cards and slots go square and ringless. */
const RAIL_FLAT_CHROME = "[[data-session-rail-flat]_&]:rounded-none [[data-session-rail-flat]_&]:shadow-none";

/** Upstream's `data-rail-card` slot around each card; its radius follows `RAIL_CARD_CLASS`. Upstream's `contents has-[[data-rail-section]]:flex` only matters for empty slots, which never render here. */
export const RAIL_SLOT_CLASS = "relative flex flex-col rounded-r7 [[data-session-rail-flat]_&]:rounded-none";

/** A rail card's radius and ring (upstream's `rounded-card shadow-card-ring`), outset in light and inset in dark, dropped in a flat rail. */
export const RAIL_CARD_RING_CLASS = `rounded-r7 shadow-[0_0_0_1px_var(--color-border)] dark:shadow-[inset_0_0_0_1px_var(--color-border)] ${RAIL_FLAT_CHROME}`;

/**
 * Upstream's flat-rail section hairline (shared-20 `zy`, built on `el`): a 1px bg-alpha-1 line 16px in
 * from each side on a card's top edge, drawn only when an earlier present, non-empty slot precedes it,
 * so the first card never draws one. Local has no empty slots, so upstream's bare-section half is moot.
 */
const RAIL_CARD_DIVIDER_CLASS =
	"relative before:absolute before:inset-x-4 before:top-0 before:h-px [[data-session-rail-flat]_:not(:empty):not([data-rail-slot-off])~[data-rail-card]>&]:before:bg-alpha-1";

/** Upstream's lined card (`epitaxy-rail-lined`): py-md 8px, pb-sm 6px while open, the card ring, and the flat-rail hairline. */
export const RAIL_CARD_CLASS = `group/railcard epitaxy-rail-lined flex shrink-0 flex-col pt-2 pb-2 data-open:pb-1.5 ${RAIL_CARD_RING_CLASS} ${RAIL_CARD_DIVIDER_CLASS}`;

/** Upstream's rail Show more / Show less toggle. */
const SHOW_MORE_CLASS =
	"flex min-h-8 w-full min-w-0 cursor-pointer items-center rounded px-2 text-start text-body text-ink-muted hover:text-primary hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";

/** Upstream's rail Show more / Show less row. */
export function ShowMoreButton({state}: {state: ShowMoreState})
{
	return (
		<button
			type="button"
			aria-expanded={state.expanded}
			className={SHOW_MORE_CLASS}
			onClick={(event) =>
			{
				// A keyboard press (detail 0) moves focus to the first row it reveals.
				state.toggle(event.detail === 0);
			}}
		>
			<span data-rail-row-label="" className="min-w-0 truncate">
				{state.expanded ? "Show less" : "Show more"}
			</span>
		</button>
	);
}
