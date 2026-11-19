import type {Density} from "./ui/density-context";

/*
 * Upstream's slash portal copies its opener's density. The epitaxy root is compact unless a
 * coarse pointer, a density override or the fizzy-lake "panels" rollout makes it comfortable.
 * The rows are `h-control` (24px compact, 28px comfortable), not the generic menu's 32px
 * comfortable rows, so this keeps its own map. Heights feed the virtualizer: a section header
 * is `py-1` plus one footnote line per `whitespace-pre-line` line, a separator 1px plus `my-1`
 * (upstream's `mx-2.5` at every density since 2026-11-01), and the gutter is `p-1`/`p-1.5`.
 */
export const SLASH_DENSITY =
{
	compact:
	{
		popup: "rounded-r7",
		scroller: "p-1",
		row: "h-6 items-center gap-1.5 rounded-r5 px-2 py-[2.5px] text-body",
		header: "px-2 py-1 text-[12px]/[15px] font-medium text-ink-muted whitespace-pre-line",
		separator: "mx-2.5 my-1 h-px bg-border",
		loading: "flex h-6 items-center gap-1.5 px-2",
		rowHeight: 24,
		gutter: 4,
		headerLineHeight: 15,
	},
	comfortable:
	{
		popup: "rounded-menu-comfortable",
		scroller: "p-1.5",
		row: "h-7 items-center gap-2 rounded-r6 px-2.5 py-1 text-[14px]/[20px]",
		header: "px-2.5 py-1 text-[13px]/[17px] font-medium text-ink-muted whitespace-pre-line",
		separator: "mx-2.5 my-1 h-px bg-border",
		loading: "flex h-7 items-center gap-2 px-2.5",
		rowHeight: 28,
		gutter: 6,
		headerLineHeight: 17,
	},
} as const;

export type SlashSizing = (typeof SLASH_DENSITY)[Density];

export const POPUP_SURFACE_CLASS =
	"z-[130] flex min-w-60 max-w-[min(32rem,calc(100vw-16px))] flex-col bg-[var(--menu-bg)] text-primary shadow-[var(--menu-shadow)] select-none";

/*
 * Upstream's positioner caps: `maxHeightCap` 384 with the grouped menu's gate off; with it on (`fixedWidth` 260) the
 * grouped empty view has no cap (the available height wins) and a typed query caps at 480.
 */
export function popupClass(compactHost: boolean, grouped: boolean): string
{
	const size = compactHost ? (grouped ? "w-[260px]" : "w-[260px] max-h-[480px]") : "w-max max-h-96";
	return `absolute bottom-full left-0 mb-2 ${size} ${POPUP_SURFACE_CLASS}`;
}
