import type {ReactNode} from "react";

import type {SlashMenuItem} from "../lib/slash-commands";
import {popupClass, SLASH_DENSITY, type SlashSizing} from "./slash-command-menu-classes";
import {useScopeDensity} from "./ui/density-context";

// The "/" popup's frame and skeleton, kept out of the menu's lazy chunk so its loading placeholder and inline
// ErrorView draw in the same popup the menu would.

/* Upstream's iconless `loading` row: a cds SkeletonGroup (`Skeleton.Rows` icon:false) of 120×16 bars (`JO[0]`). */
const LOADING_BAR_CLASS = "max-w-full rounded bg-[var(--skeleton-base)]";

/** Upstream's `Skeleton.Rows` inside the popup: `rows` iconless 120×16 bars in an overlay-hold SkeletonGroup. */
export function SlashLoadingBars({sizing, rows}: {sizing: SlashSizing; rows: number})
{
	return (
		<div data-skeleton-group="" data-motion="wave" data-hold="none" data-hold-reason="overlay" role="status">
			<span className="sr-only">Loading</span>
			<div aria-hidden="true" className="contents">
				{Array.from(
					{
						length: rows,
					},
					(_, row) => (
						<div key={row} className={sizing.loading}>
							<div
								data-skeleton=""
								className={LOADING_BAR_CLASS}
								style={
								{
									width: "120px",
									height: "16px",
								}}
							/>
						</div>
					),
				)}
			</div>
		</div>
	);
}

/* Upstream `h_`: the popup body skeleton draws at most 11 rows. */
const SKELETON_ROW_CAP = 11;

interface SlashMenuFrameProps
{
	items: readonly SlashMenuItem[];
	compactHost?: boolean;
	grouped?: boolean;
}

/** The popup around the menu body while its chunk downloads or after it failed (upstream's eager `Hv` positioner). */
export function SlashMenuFrame({
	compactHost = false,
	grouped = false,
	children,
}: SlashMenuFrameProps &
{
	children: ReactNode;
})
{
	const sizing = SLASH_DENSITY[useScopeDensity()];
	return (
		// oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- cancels mousedown so the composer textarea keeps focus
		<div
			data-slash-menu-frame=""
			className={`${popupClass(compactHost, grouped)} ${sizing.popup}`}
			onMouseDown={(e) =>
			{
				e.preventDefault();
			}}
		>
			<div className={`relative min-h-0 overflow-hidden rounded-[inherit] ${sizing.scroller}`}>{children}</div>
		</div>
	);
}

/** Upstream `Mh`: one skeleton row per real item the popup already knows, between 1 and 11. */
export function SlashMenuSkeleton({items}: SlashMenuFrameProps)
{
	const sizing = SLASH_DENSITY[useScopeDensity()];
	const known = items.filter((item) => item.type !== "separator" && item.type !== "loading").length;
	return <SlashLoadingBars sizing={sizing} rows={Math.max(1, Math.min(known, SKELETON_ROW_CAP))} />;
}
