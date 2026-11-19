import type {FileDiffMetadata, SelectedLineRange} from "@pierre/diffs";

import type {DiffSide} from "./diff-comments";

/**
 * Where a Changes pane comment anchors for a line-number drag or a gutter "+", ported from upstream claude.ai/code
 * c44d00c7f (`ld`, `ud`, `dd`, `md`, `fd`, `Hu` and the `pd` hook's `anchorSpan`/`selectionEnd`/`hoverAdd`).
 */

/** A comment target: lines `line`..`endLine` on one side. */
export interface AnchoredRange
{
	side: DiffSide;
	line: number;
	endLine: number;
}

/** The gutter "+" guard: the line and side a multi-line drag last ended on. */
export interface GutterAddGuard
{
	current:
	{
		side: DiffSide;
		line: number;
	} | null;
}

/** Upstream `ld`: more than one line, or one line spanning both split columns. */
export function isMultiLine(range: SelectedLineRange): boolean
{
	return range.start !== range.end || (range.endSide !== undefined && range.endSide !== range.side);
}

/** A hunk's first old and new line numbers (a zero-count side starts one past its header number). */
function hunkStarts(hunk: FileDiffMetadata["hunks"][number]): [number, number]
{
	return [
		hunk.deletionStart + Number(hunk.deletionCount === 0),
		hunk.additionStart + Number(hunk.additionCount === 0),
	];
}

/**
 * Upstream `ud`: old lines `start`..`end` mapped to the new side when they lie wholly in unchanged lines (the new
 * number of `start`), or undefined when they touch a removed line or, in a partial diff, fall outside every hunk.
 */
function contextStartOnNewSide(meta: FileDiffMetadata, start: number, end: number): number | undefined
{
	if (
		meta.isPartial &&
		!meta.hunks.some((hunk) => start >= hunk.deletionStart && end < hunk.deletionStart + hunk.deletionCount)
	)
		return undefined;
	let offset = 0;
	for (const hunk of meta.hunks)
	{
		let [oldLine, newLine] = hunkStarts(hunk);
		for (const content of hunk.hunkContent)
		{
			if (content.type === "context")
			{
				oldLine += content.lines;
				newLine += content.lines;
				continue;
			}
			if (end < oldLine) return start + (newLine - oldLine);
			if (start < oldLine + content.deletions) return undefined;
			oldLine += content.deletions;
			newLine += content.additions;
		}
		offset = newLine - oldLine;
	}
	return start + offset;
}

/**
 * Upstream `Hu`: an old line's number in the new file. A removed line maps to its block's first new line, or to the
 * line before an outright deletion (never below 1).
 */
export function oldToNewLine(meta: FileDiffMetadata, oldLine: number): number
{
	let offset = 0;
	for (const hunk of meta.hunks)
	{
		let [old, line] = hunkStarts(hunk);
		for (const content of hunk.hunkContent)
		{
			if (content.type === "context")
			{
				old += content.lines;
				line += content.lines;
				continue;
			}
			if (oldLine < old) return oldLine + (line - old);
			if (oldLine < old + content.deletions) return Math.max(content.additions === 0 ? line - 1 : line, 1);
			old += content.deletions;
			line += content.additions;
		}
		offset = line - old;
	}
	return oldLine + offset;
}

/** Upstream `dd`'s result: the other side's line just above and below, and the change block's index (-1 outside). */
interface CrossSideLine
{
	above: number;
	below: number;
	change: number;
}

/** Upstream `dd`: a line on `side` mapped onto the other side, pairing changed rows as `split` view lays them out. */
function mapToOtherSide(meta: FileDiffMetadata, side: DiffSide, line: number, split: boolean): CrossSideLine
{
	const fromOld = side === "deletions";
	let change = -1;
	let offset = 0;
	for (const hunk of meta.hunks)
	{
		let [old, added] = hunkStarts(hunk);
		for (const content of hunk.hunkContent)
		{
			if (content.type === "context")
			{
				old += content.lines;
				added += content.lines;
				continue;
			}
			change += 1;
			const [from, fromCount, to, toCount] = fromOld
				? [old, content.deletions, added, content.additions]
				: [added, content.additions, old, content.deletions];
			const delta = line - from;
			if (delta < 0)
				return {
					above: to + delta,
					below: to + delta,
					change: -1,
				};
			if (delta < fromCount)
			{
				const mapped = to + (split ? Math.min(delta, toCount) : fromOld ? 0 : toCount);
				return {
					above: split && delta < toCount ? mapped : mapped - 1,
					below: mapped,
					change,
				};
			}
			old += content.deletions;
			added += content.additions;
		}
		offset = fromOld ? added - old : old - added;
	}
	return {
		above: line + offset,
		below: line + offset,
		change: -1,
	};
}

/** Upstream `md`: the mapped line on the far side of `line`. */
function pickMapped(line: number, mapped: CrossSideLine): number
{
	return line >= mapped.below ? mapped.below : mapped.above;
}

/** Upstream `fd`: whether `line` on `side` lies inside a hunk. */
function inHunk(meta: FileDiffMetadata, side: DiffSide, line: number): boolean
{
	return meta.hunks.some((hunk) =>
	{
		const [start, count] =
			side === "deletions" ? [hunk.deletionStart, hunk.deletionCount] : [hunk.additionStart, hunk.additionCount];
		return line >= start && line < start + count;
	});
}

/**
 * Upstream `pd` `anchorSpan` then `openDraft`'s min/max: lines `a`..`b` on `side`, moved to the additions side when
 * they are old lines lying wholly in unchanged context.
 */
export function anchorSpan(meta: FileDiffMetadata, a: number, b: number, side: DiffSide): AnchoredRange
{
	const low = Math.min(a, b);
	const mapped = side === "deletions" ? contextStartOnNewSide(meta, low, Math.max(a, b)) : undefined;
	const [start, end, anchored] =
		mapped === undefined ? [a, b, side] : [a + mapped - low, b + mapped - low, "additions" as const];
	return {
		side: anchored,
		line: Math.min(start, end),
		endLine: Math.max(start, end),
	};
}

/**
 * Upstream `pd` `selectionEnd`: the comment target of a finished line-number drag, or null for a single-line press.
 * A split drag from one column into the other anchors both ends on the end column.
 */
export function selectionTarget(meta: FileDiffMetadata, range: SelectedLineRange, split: boolean): AnchoredRange | null
{
	if (!isMultiLine(range)) return null;
	const endSide = range.endSide ?? range.side ?? "additions";
	const startSide = range.side ?? endSide;
	if (startSide === endSide) return anchorSpan(meta, range.start, range.end, endSide);
	const start = mapToOtherSide(meta, startSide, range.start, split);
	const end = mapToOtherSide(meta, endSide, range.end, split);
	const startOnEndSide = pickMapped(range.end, start);
	const onAdditions =
		endSide === "deletions" &&
		((range.start === range.end && start.change >= 0 && start.change === end.change) ||
			contextStartOnNewSide(meta, Math.min(startOnEndSide, range.end), Math.max(startOnEndSide, range.end)) !==
				undefined);
	const [kept, other] = onAdditions ? [range.start, end] : [range.end, start];
	const side = onAdditions ? "additions" : endSide;
	const across = pickMapped(kept, other);
	return anchorSpan(meta, meta.isPartial && !inHunk(meta, side, across) ? kept : across, kept, side);
}

/**
 * Upstream `pd` `hoverAdd`'s guard: the "+" click that lands right after a drag ends on its line is swallowed once.
 * Clears the guard when it matches.
 */
export function shouldSwallowGutterAdd(
	guard: GutterAddGuard,
	target:
	{
		side: DiffSide;
		line: number;
	},
): boolean
{
	const {current} = guard;
	if (current?.line !== target.line || current.side !== target.side) return false;
	guard.current = null;
	return true;
}

/** The parts of pierre's `onLineNumberClick` props that upstream's `Gu` reads. */
export interface LineNumberClick
{
	event:
	{
		metaKey: boolean;
		ctrlKey: boolean;
		composedPath: () => readonly unknown[];
	};
	lineNumber: number;
	annotationSide: DiffSide;
}

/** A composed-path node that can carry attributes (upstream `O(t)?.hasAttribute`). */
function hasAttributes(node: unknown): node is Pick<Element, "hasAttribute">
{
	return (
		typeof node === "object" && node !== null && "hasAttribute" in node && typeof node.hasAttribute === "function"
	);
}

/** Upstream `Uu`: the click went through the gutter "+" slot. */
function inGutterUtilitySlot(path: readonly unknown[]): boolean
{
	return path.some((node) => hasAttributes(node) && node.hasAttribute("data-gutter-utility-slot"));
}

/**
 * Upstream `Gu`: the new file's line a ⌘/Ctrl+click on a line number opens, or null for a plain click or one through
 * the gutter "+". A deletions-side number maps to the new file with `oldToNewLine` (upstream `Hu`).
 */
export function lineNumberOpenLine(
	meta: FileDiffMetadata,
	{event, lineNumber, annotationSide}: LineNumberClick,
): number | null
{
	if (!event.metaKey && !event.ctrlKey) return null;
	if (inGutterUtilitySlot(event.composedPath())) return null;
	return annotationSide === "deletions" ? oldToNewLine(meta, lineNumber) : lineNumber;
}
