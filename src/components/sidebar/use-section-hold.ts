import {useMemo, useState} from "react";

import {truncates, type SessionGroup} from "../../lib/session-groups";
import {useSidebarMenuMode} from "../../lib/sidebar-menu-open";
import {reduceSectionView, revealStep} from "../../lib/sidebar-section-hold";
import type {SidebarSessionRow} from "./sidebar-session-row";
import {useFocusedSectionRowKey} from "./use-focused-row-key";

export interface SectionHold
{
	/** The section as shown: held rows, their families, and the hidden count and Show more label they leave. */
	group: SessionGroup<SidebarSessionRow>;
	/** Rows past the first page the view reveals, grown past the group's when a focus hold released (upstream `gy`). */
	extraRevealed: number;
	/** How many rows past the shown ones a Show more click adds (upstream `U`): a page plus the held rows past the cutoff. */
	showMoreStep: number;
}

/**
 * Upstream `tQ`'s hold: while a sidebar menu is open or one of this section's rows has focus, the section keeps the
 * rows it showed, so a live re-sort can't push a row in use behind Show more.
 */
export function useSectionHold(
	group: SessionGroup<SidebarSessionRow>,
	{
		epoch,
		order,
	}:
	{
		epoch: string;
		order: string;
	},
): SectionHold
{
	const {sorted, pageSize, extraRevealed, headOf, allNested} = group;
	const truncating = truncates(sorted.length, pageSize, extraRevealed);
	const keys = useMemo(
		() => (truncating ? new Set([...sorted.map((row) => row.sessionId), ...headOf.keys()]) : null),
		[truncating, sorted, headOf],
	);
	const focused = useFocusedSectionRowKey(keys);
	const mode = useSidebarMenuMode(truncating);
	const input =
	{
		epoch,
		order,
		sortMenuOpen: mode === "sort",
		sorted,
		truncateAt: pageSize,
		extraRevealed,
		focusedRowKey: focused === null ? null : (headOf.get(focused) ?? focused),
		menuOpen: mode !== "none",
	};
	// Upstream `Uz`: derived state, the reducer folding each render's input into the previous view.
	const [view, setView] = useState(() => reduceSectionView(input, null));
	const next = reduceSectionView(input, view);
	if (next !== view) setView(next);
	const step = pageSize + revealStep(sorted, next.visible, pageSize, pageSize + extraRevealed);
	const shown = useMemo(() =>
	{
		if (!next.holding && next.extraRevealed === extraRevealed) return group;
		const rows = [...next.visible];
		const shownKeys = new Set(rows.map((row) => row.sessionId));
		const hidden = sorted.filter((row) => !shownKeys.has(row.sessionId));
		const nested = new Map(
			rows.flatMap((row) =>
			{
				const children = allNested.get(row.sessionId);
				return children === undefined ? [] : [[row.sessionId, children] as const];
			}),
		);
		return {
			...group,
			rows,
			nested,
			hiddenCount: next.hiddenCount,
			revealCount:
				next.hiddenCount === 0
					? 0
					: truncates(sorted.length, pageSize, extraRevealed + step)
						? pageSize
						: next.hiddenCount,
			hiddenAwaiting: hidden.some(
				(row) =>
					row.bucket === "blocked" ||
					(allNested.get(row.sessionId) ?? []).some((child) => child.bucket === "blocked"),
			),
			canShowLess: extraRevealed > 0 && next.hiddenCount === 0 && truncates(sorted.length, pageSize, 0),
		};
	}, [group, next, extraRevealed, sorted, pageSize, allNested, step]);
	return {
		group: shown,
		extraRevealed: next.extraRevealed,
		showMoreStep: step,
	};
}
