/*
 * The Changes pane's scroll anchor for the whole-file toggle, after claude.ai/code's c44d00c7f `Jt`: before the
 * toggle it finds the first line row below the sticky file header (`zd`), and afterwards scrolls that row back to
 * where it was.
 */

export type LineSide = "additions" | "deletions";

/** A diff line and how far below the scroller's top it sat. */
export interface LineAnchor
{
	path: string;
	side: LineSide;
	lineNumber: number;
	viewportOffset: number;
}

/** Upstream `gd`: the sticky file header's height, 32px at a 16px root font size. */
export function stickyHeaderOffset(rootFontSize: number): number
{
	return (32 * rootFontSize) / 16;
}

interface LineRow
{
	path: string;
	side: LineSide;
	lineNumber: number;
	element: Element;
}

function* lineRows(scroller: HTMLElement): Generator<LineRow>
{
	for (const container of scroller.querySelectorAll("diffs-container"))
	{
		const path = container.querySelector("[data-diff-file-header]")?.getAttribute("data-diff-file-header");
		if (path === null || path === undefined) continue;
		for (const element of container.shadowRoot?.querySelectorAll("[data-content] > [data-line]") ?? [])
		{
			const lineNumber = Number(element.getAttribute("data-line"));
			if (!Number.isFinite(lineNumber)) continue;
			const deletions =
				element.getAttribute("data-line-type") === "change-deletion" ||
				element.closest("[data-deletions]") !== null;
			yield {
				path,
				side: deletions ? "deletions" : "additions",
				lineNumber,
				element,
			};
		}
	}
}

/** Upstream `zd`: the first line row whose top is at or below the sticky header and that `skip` doesn't reject. */
export function findLineAnchor(
	scroller: HTMLElement,
	headerOffset: number,
	skip?: (path: string, side: LineSide, lineNumber: number) => boolean,
): LineAnchor | null
{
	const top = scroller.getBoundingClientRect().top;
	for (const row of lineRows(scroller))
	{
		const rowTop = row.element.getBoundingClientRect().top;
		if (rowTop < top + headerOffset) continue;
		if (skip?.(row.path, row.side, row.lineNumber) === true) continue;
		return {
			path: row.path,
			side: row.side,
			lineNumber: row.lineNumber,
			viewportOffset: rowTop - top,
		};
	}
	return null;
}

/** Scrolls the anchored row back to its offset (upstream's instant, align-start `scrollTo`); false when it's gone. */
export function restoreLineAnchor(scroller: HTMLElement, anchor: LineAnchor): boolean
{
	const top = scroller.getBoundingClientRect().top;
	for (const row of lineRows(scroller))
	{
		if (row.path !== anchor.path || row.side !== anchor.side || row.lineNumber !== anchor.lineNumber) continue;
		const delta = Math.round(row.element.getBoundingClientRect().top - top - anchor.viewportOffset);
		if (delta !== 0) scroller.scrollTop += delta;
		return true;
	}
	return false;
}
