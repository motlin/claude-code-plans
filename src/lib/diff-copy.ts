import type {FileDiffMetadata} from "@pierre/diffs";

/*
 * claude.ai/code's Changes pane copy (cd9a11070 `T`/`v`/`h`/`g`, c44d00c7f `cc` + the `qd` copy effect): a copy
 * inside one file's diff puts only the shown code rows' text on the clipboard, as text/plain.
 */

export interface DiffCopyRow
{
	side: "additions" | "deletions";
	line: number;
	text: string;
	oldLine?: number;
	oldText?: string;
}

const DIFFS_CONTAINER = "diffs-container";

/** Upstream shared-0 `Hk`: how many `shadowRoot.activeElement` hops the editable check follows. */
const MAX_FOCUS_HOPS = 32;

/** Upstream c91a5e4a6 `L`: drop ONE trailing `\n` (a blank row renders as a lone `"\n"`). */
function stripRowNewline(text: string): string
{
	return text.endsWith("\n") ? text.slice(0, -1) : text;
}

/** Upstream cbe9ab01c `Qt`: drop one trailing `\n` or `\r\n`. */
function stripLineEnding(text: string): string
{
	if (text.endsWith("\r\n")) return text.slice(0, -2);
	return stripRowNewline(text);
}

/** Upstream c91a5e4a6 `I`. */
export function diffRowSide(row: Element): DiffCopyRow["side"]
{
	return row.getAttribute("data-line-type") === "change-deletion" || row.closest("[data-deletions]") !== null
		? "deletions"
		: "additions";
}

/** Upstream cd9a11070 `u`: the outermost `diffs-container` between `target` and `wrapper`, or null outside `wrapper`. */
export function diffHostOf(wrapper: Element, target: Element): Element | null
{
	let host: Element | null = null;
	for (let element: Element | null = target; element !== null; element = element.parentElement)
	{
		if (element === wrapper) return host;
		if (element.tagName.toLowerCase() === DIFFS_CONTAINER) host = element;
	}
	return null;
}

/** Upstream cd9a11070 `d`: the options form first, then the older positional form. */
function composedRange(selection: Selection, root: ShadowRoot): AbstractRange | undefined
{
	try
	{
		return selection.getComposedRanges(
			{
				shadowRoots: [root],
			},
		)[0];
	}
	catch
	{
		try
		{
			const legacy: unknown = Reflect.get(selection, "getComposedRanges");
			const ranges: unknown = typeof legacy === "function" ? Reflect.apply(legacy, selection, [root]) : undefined;
			const first: unknown = Array.isArray(ranges) ? ranges[0] : undefined;
			return first instanceof AbstractRange ? first : undefined;
		}
		catch
		{
			return undefined;
		}
	}
}

function touchesRoot(root: ShadowRoot, range: AbstractRange): boolean
{
	return !range.collapsed && (root.contains(range.startContainer) || root.contains(range.endContainer));
}

/** Upstream cd9a11070 `f`: the selection's range as seen from inside `root`, when one end is in it. */
export function selectionRangeIn(root: ShadowRoot, selection: Selection): AbstractRange | null
{
	// Optional at runtime: older browsers and jsdom lack it.
	if ("getComposedRanges" in selection)
	{
		const range = composedRange(selection, root);
		return range !== undefined && touchesRoot(root, range) ? range : null;
	}
	const scoped = (
		root as ShadowRoot &
		{
			getSelection?: () => Selection | null;
		}
	).getSelection?.();
	if (scoped === null || scoped === undefined || scoped.rangeCount === 0) return null;
	const range = scoped.getRangeAt(0);
	return touchesRoot(root, range) ? range : null;
}

/** Upstream cd9a11070 `p`: whether `range` overlaps `row`'s contents. */
function intersects(range: Range, row: Range): boolean
{
	return (
		range.compareBoundaryPoints(Range.END_TO_START, row) < 0 &&
		range.compareBoundaryPoints(Range.START_TO_END, row) > 0
	);
}

/** Upstream cd9a11070 `m`: a select-node-contents range on an ancestor of the rows' parent (`code`, `pre`, the root). */
function wholeContent(root: ShadowRoot, range: AbstractRange): boolean
{
	const start = range.startContainer;
	const rows = root.querySelector("[data-line]")?.parentNode;
	return (
		rows !== undefined &&
		rows !== null &&
		start !== rows &&
		start.contains(rows) &&
		range.endContainer === start &&
		range.startOffset === 0 &&
		range.endOffset === start.childNodes.length
	);
}

/** Upstream cd9a11070 `g`: a split diff copies its deletion column (context by old line), then its addition column. */
function inColumnOrder(rows: DiffCopyRow[], split: boolean): DiffCopyRow[]
{
	if (!split) return [...rows];
	return [
		...rows
			.filter((row) => row.side === "deletions" || row.oldLine !== undefined)
			.map((row): DiffCopyRow => (
			{
				side: "deletions",
				line: row.oldLine ?? row.line,
				text: row.oldText ?? row.text,
			})),
		...rows.filter((row) => row.side === "additions"),
	];
}

interface CopiedRows
{
	rows: DiffCopyRow[];
	startsBeforeFirstRow: boolean;
	endsAfterLastRow: boolean;
}

/** Upstream cd9a11070 `h`: the rows `selected` covers, clipped to it. */
function copiedRows(
	root: ShadowRoot,
	selected: AbstractRange,
	shownRows: (() => DiffCopyRow[] | null) | undefined,
): CopiedRows | null
{
	const document = root.ownerDocument;
	const range = document.createRange();
	try
	{
		range.setStart(selected.startContainer, selected.startOffset);
		range.setEnd(selected.endContainer, selected.endOffset);
	}
	catch
	{
		return null;
	}
	if (range.collapsed) return null;
	const rows: DiffCopyRow[] = [];
	let startsBeforeFirstRow = false;
	let lastRow: Range | null = null;
	for (const element of root.querySelectorAll("[data-line]"))
	{
		const line = Number.parseInt(element.getAttribute("data-line") ?? "", 10);
		if (!Number.isFinite(line)) continue;
		const row = document.createRange();
		row.selectNodeContents(element);
		if (!intersects(range, row)) continue;
		const clipped = range.cloneRange();
		if (clipped.compareBoundaryPoints(Range.START_TO_START, row) < 0)
			clipped.setStart(row.startContainer, row.startOffset);
		if (clipped.compareBoundaryPoints(Range.END_TO_END, row) > 0) clipped.setEnd(row.endContainer, row.endOffset);
		const text = clipped.toString();
		const wrapsRow =
			range.compareBoundaryPoints(Range.START_TO_START, row) <= 0 &&
			range.compareBoundaryPoints(Range.END_TO_END, row) >= 0;
		if (text.length === 0 && !wrapsRow)
		{
			startsBeforeFirstRow ||= rows.length === 0;
			continue;
		}
		rows.push(
			{
				side: diffRowSide(element),
				line,
				text: stripRowNewline(text),
			},
		);
		lastRow = row;
	}
	const split = root.querySelector("[data-deletions], [data-additions]") !== null;
	const shown = wholeContent(root, selected) ? shownRows?.() : null;
	const model = shown === null || shown === undefined ? null : inColumnOrder(shown, split);
	const modelKeys = new Set(model?.map((row) => `${row.side}:${row.line}`));
	const allShown = rows.every((row) => modelKeys.has(`${row.side}:${row.line}`));
	return {
		rows: model !== null && allShown ? model : rows,
		startsBeforeFirstRow,
		endsAfterLastRow: lastRow !== null && range.compareBoundaryPoints(Range.END_TO_END, lastRow) > 0,
	};
}

/**
 * Upstream cd9a11070 `v`: the clipboard text for `range` inside one diff's shadow root, or null to keep the native
 * copy. `shownRows` gives the file's shown rows from its model, used for a whole-content range so virtualized-out
 * rows are copied too.
 */
export function diffCopyText(
	root: ShadowRoot,
	range: AbstractRange,
	shownRows?: () => DiffCopyRow[] | null,
): string | null
{
	const copied = copiedRows(root, range, shownRows);
	if (copied === null || copied.rows.length === 0) return null;
	const text =
		(copied.startsBeforeFirstRow ? "\n" : "") +
		copied.rows.map((row) => row.text).join("\n") +
		(copied.endsAfterLastRow ? "\n" : "");
	return text === "" ? null : text;
}

/** Upstream shared-0 `Z8`. */
function isEditable(element: Element | null): boolean
{
	if (element === null) return false;
	const tag = element.tagName;
	if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
	if (element instanceof HTMLElement && typeof element.isContentEditable === "boolean")
		return element.isContentEditable;
	const editable = element.closest("[contenteditable]");
	return editable !== null && editable.getAttribute("contenteditable")?.toLowerCase() !== "false";
}

/** Upstream shared-0 `VC`: `element`, or the element focused through its shadow roots, is editable. */
export function isEditableDeep(element: Element | null): boolean
{
	if (isEditable(element)) return true;
	let current = element;
	for (let hop = 0; hop < MAX_FOCUS_HOPS && current !== null; hop += 1)
	{
		const next: Element | null = current.shadowRoot?.activeElement ?? null;
		if (next === null || next === current) return false;
		if (isEditable(next)) return true;
		current = next;
	}
	return false;
}

/**
 * Upstream c44d00c7f `cc`: a file's shown rows, in model order. Collapsed context outside the hunks (only in a whole
 * diff) is kept where `isLineRenderable` says it is shown; a partial (patch-only) diff gives every hunk row.
 */
export function shownDiffRows(fileDiff: FileDiffMetadata, isLineRenderable?: (line: number) => boolean): DiffCopyRow[]
{
	const rows: DiffCopyRow[] = [];
	let additionLine = 1;
	let deletionLine = 1;
	const emit = (
		kind: "both" | "additions" | "deletions",
		count: number,
		additionIndex: number,
		deletionIndex: number,
		collapsed = false,
	) =>
	{
		for (let offset = 0; offset < count; offset += 1)
		{
			if (!collapsed || isLineRenderable?.(additionLine) === true)
			{
				const oldText = stripLineEnding(fileDiff.deletionLines[deletionIndex + offset] ?? "");
				const text = stripLineEnding(fileDiff.additionLines[additionIndex + offset] ?? "");
				if (kind === "deletions")
				{
					rows.push(
						{
							side: kind,
							line: deletionLine,
							text: oldText,
						},
					);
				}
				else
				{
					rows.push(
						{
							side: "additions",
							line: additionLine,
							text,
							...(kind === "both"
								?
									{
										oldLine: deletionLine,
										oldText,
									}
								: {}),
						},
					);
				}
			}
			if (kind !== "deletions") additionLine += 1;
			if (kind !== "additions") deletionLine += 1;
		}
	};
	for (const hunk of fileDiff.hunks)
	{
		const start = hunk.additionStart + (hunk.additionCount === 0 ? 1 : 0);
		if (fileDiff.isPartial)
		{
			additionLine = start;
			deletionLine = hunk.deletionStart + (hunk.deletionCount === 0 ? 1 : 0);
		}
		else emit("both", start - additionLine, additionLine - 1, deletionLine - 1, true);
		for (const content of hunk.hunkContent)
		{
			if (content.type === "context")
			{
				emit("both", content.lines, content.additionLineIndex, content.deletionLineIndex);
			}
			else
			{
				emit("deletions", content.deletions, content.additionLineIndex, content.deletionLineIndex);
				emit("additions", content.additions, content.additionLineIndex, content.deletionLineIndex);
			}
		}
	}
	if (!fileDiff.isPartial && fileDiff.hunks.length > 0)
	{
		emit("both", fileDiff.additionLines.length - additionLine + 1, additionLine - 1, deletionLine - 1, true);
	}
	return rows;
}
