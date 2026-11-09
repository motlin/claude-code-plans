import {type MouseEvent, type ReactNode, useEffect, useState} from "react";

import {writeClipboardText} from "../../lib/clipboard";
import {attachContext} from "../../lib/context-attach";
import {type DiffSide, openDiffCommentDraft} from "../../lib/diff-comments";
import {detectLanguage} from "../../lib/diff-utils";
import {useToast} from "../toast-context";
import {SELECTION_BAR_BUTTON_CLASS, SELECTION_BAR_CLASS} from "../transcript-selection-bar";
import {findScrollContainer} from "../scroll-container";
import {ContextMenu, ContextMenuTrigger, MenuContent, MenuItem, MenuSeparator} from "../ui/menu";

/** The diff lines a right-click lands on: the selection inside the diff, or the clicked line. */
interface DiffLineSelection {
	side: DiffSide;
	line: number;
	endLine: number;
	text: string;
}

function rowSide(row: Element): DiffSide {
	switch (row.getAttribute("data-line-type")) {
		case "change-deletion":
			return "deletions";
		case "change-addition":
			return "additions";
		default:
			return row.closest("[data-code]")?.hasAttribute("data-deletions") ? "deletions" : "additions";
	}
}

function rowText(row: Element): string {
	return row.textContent.replace(/\n$/, "");
}

/** The code row for a node inside the diff: a `[data-line]` row, or the row a line number labels. */
function rowOf(node: Node | null): Element | null {
	const element = node instanceof Element ? node : (node?.parentElement ?? null);
	const row = element?.closest("[data-line], [data-column-number]") ?? null;
	if (row === null || row.hasAttribute("data-line")) return row;
	const index = row.getAttribute("data-line-index");
	const code = row.closest("[data-code]");
	if (index === null || code === null) return null;
	return code.querySelector(`[data-line][data-line-index="${CSS.escape(index)}"]`);
}

/** The rows from `first` to `last` in document order that sit on `last`'s side. */
function rowsBetween(first: Element, last: Element): Element[] {
	const code = last.closest("[data-code]");
	if (code === null) return [last];
	const rows = [...code.querySelectorAll("[data-line]")];
	const [from, to] = [rows.indexOf(first), rows.indexOf(last)].toSorted((a, b) => a - b);
	if (from === undefined || to === undefined || from === -1) return [last];
	const side = rowSide(last);
	return rows.slice(from, to + 1).filter((row) => rowSide(row) === side);
}

function selectionIn(root: ShadowRoot): Selection | null {
	const scoped = (root as ShadowRoot & {getSelection?: () => Selection | null}).getSelection;
	const selection = typeof scoped === "function" ? scoped.call(root) : document.getSelection();
	if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return null;
	const node = selection.getRangeAt(0).commonAncestorContainer;
	return node.getRootNode() === root ? selection : null;
}

function selectionOf(rows: Element[]): DiffLineSelection | null {
	const first = rows[0];
	const last = rows.at(-1);
	if (first === undefined || last === undefined) return null;
	const line = Number(first.getAttribute("data-line"));
	const endLine = Number(last.getAttribute("data-line"));
	if (!Number.isSafeInteger(line) || !Number.isSafeInteger(endLine)) return null;
	return {side: rowSide(last), line, endLine, text: rows.map(rowText).join("\n")};
}

/** Upstream's "line N" / "lines A–B" for a comment's accessible name. */
function linesLabel({line, endLine}: DiffLineSelection): string {
	return line === endLine ? `line ${line}` : `lines ${line}–${endLine}`;
}

/** The diff row an event lands on, through the `@pierre/diffs` shadow root. */
function eventRow(event: MouseEvent): Element | null {
	const path = event.nativeEvent.composedPath();
	return rowOf(path.find((target): target is Element => target instanceof Element) ?? null);
}

/** The rows a selection inside the row's shadow root spans, or null without one. */
function selectedRows(row: Element): {root: ShadowRoot; selection: Selection; rows: Element[]} | null {
	const root = row.getRootNode();
	const selection = root instanceof ShadowRoot ? selectionIn(root) : null;
	if (!(root instanceof ShadowRoot) || selection === null) return null;
	const anchor = rowOf(selection.anchorNode);
	const focus = rowOf(selection.focusNode);
	if (anchor === null || focus === null) return null;
	return {root, selection, rows: rowsBetween(anchor, focus)};
}

/** Resolves a right-click inside a `@pierre/diffs` shadow root to diff lines. */
function diffLinesAt(event: MouseEvent): DiffLineSelection | null {
	const clicked = eventRow(event);
	if (clicked === null) return null;
	const selected = selectedRows(clicked);
	if (selected?.rows.includes(clicked)) return selectionOf(selected.rows);
	return selectionOf([clicked]);
}

/** Upstream `Wl`: the gap between the selection and the chip. */
const CHIP_GAP = 8;
/** The chip's height: one 24px cds ghost button. */
const CHIP_HEIGHT = 24;

/** The floating chip over a diff selection, placed in the file wrapper's coordinates. */
interface SelectionChip {
	root: ShadowRoot;
	lines: DiffLineSelection;
	x: number;
	y: number;
	flipBelow: boolean;
}

/** Upstream's mouse-up chip: centred on the selection, above it unless the scroller's top cuts it off. */
function selectionChipAt(event: MouseEvent<HTMLElement>): SelectionChip | null {
	const row = eventRow(event);
	const selected = row === null ? null : selectedRows(row);
	const lines = selected === null ? null : selectionOf(selected.rows);
	if (selected === null || lines === null) return null;
	const rect = selected.selection.getRangeAt(0).getBoundingClientRect();
	const host = event.currentTarget.getBoundingClientRect();
	const scroller = findScrollContainer(event.currentTarget);
	const top =
		scroller === document.scrollingElement || scroller === document.documentElement
			? 0
			: scroller.getBoundingClientRect().top;
	const flipBelow = rect.top - CHIP_GAP - CHIP_HEIGHT < top;
	return {
		root: selected.root,
		lines,
		x: Math.round(rect.left + rect.width / 2 - host.left),
		y: Math.round((flipBelow ? rect.bottom : rect.top) - host.top),
		flipBelow,
	};
}

/**
 * The Changes pane body's right-click menu, as on claude.ai/code:
 * Attach as context · Add comment · ─ · Copy ⌘C.
 */
export function DiffContextMenu({sessionId, path, children}: {sessionId: string; path: string; children: ReactNode}) {
	const [target, setTarget] = useState<DiffLineSelection | null>(null);
	const [chip, setChip] = useState<SelectionChip | null>(null);
	const toast = useToast();

	useEffect(() => {
		if (chip === null) return undefined;
		const hideWhenCleared = () => {
			if (selectionIn(chip.root) === null) setChip(null);
		};
		document.addEventListener("selectionchange", hideWhenCleared);
		return () => {
			document.removeEventListener("selectionchange", hideWhenCleared);
		};
	}, [chip]);

	function comment(lines: DiffLineSelection) {
		const lang = detectLanguage(path);
		openDiffCommentDraft(sessionId, {
			path,
			side: lines.side,
			line: lines.line,
			endLine: lines.endLine,
			...(lines.text === "" ? {} : {snippet: lines.text}),
			...(lang === null ? {} : {lang}),
		});
	}

	function attach(lines: DiffLineSelection) {
		const attached = attachContext(sessionId, {
			kind: "selection",
			path,
			range: {start: lines.line, end: lines.endLine},
			text: lines.text,
			language: detectLanguage(path),
		});
		if (!attached) {
			toast({kind: "error", message: "Open the chat input to attach context."});
		}
	}

	function copy(lines: DiffLineSelection) {
		void writeClipboardText(lines.text).then((copied) => {
			toast(
				copied
					? {kind: "success", message: "Copied to clipboard."}
					: {kind: "error", message: "Couldn’t copy the selection."},
			);
		});
	}

	return (
		<ContextMenu>
			<ContextMenuTrigger
				render={<div className="relative" />}
				onContextMenu={(event: MouseEvent) => {
					setChip(null);
					setTarget(diffLinesAt(event));
				}}
				onMouseUp={(event: MouseEvent<HTMLElement>) => {
					// A press on the chip itself keeps it, so its click still lands.
					if (event.target instanceof Element && event.target.closest("[data-pane-editor]")) return;
					setChip(selectionChipAt(event));
				}}
			>
				{children}
				{chip !== null && (
					<div
						className="absolute isolate"
						data-pane-editor=""
						style={{
							left: chip.x,
							top: chip.y,
							transform: chip.flipBelow
								? `translate(-50%, ${CHIP_GAP}px)`
								: `translate(-50%, calc(-100% - ${CHIP_GAP}px))`,
							zIndex: 20,
						}}
					>
						<div data-surface="popover" className={SELECTION_BAR_CLASS}>
							<button
								type="button"
								className={SELECTION_BAR_BUTTON_CLASS}
								aria-label={`Add comment on ${linesLabel(chip.lines)}`}
								onMouseDown={(event) => {
									event.preventDefault();
								}}
								onClick={() => {
									comment(chip.lines);
									selectionIn(chip.root)?.removeAllRanges();
									setChip(null);
								}}
							>
								Add comment
							</button>
						</div>
					</div>
				)}
			</ContextMenuTrigger>
			<MenuContent>
				<MenuItem
					disabled={target === null}
					onSelect={() => {
						if (target) attach(target);
					}}
				>
					Attach as context
				</MenuItem>
				<MenuItem
					disabled={target === null}
					{...(target === null ? {} : {"aria-label": `Add comment on ${linesLabel(target)}`})}
					onSelect={() => {
						if (target) comment(target);
					}}
				>
					Add comment
				</MenuItem>
				<MenuSeparator />
				<MenuItem
					shortcut="cmd+c"
					disabled={target === null}
					onSelect={() => {
						if (target) copy(target);
					}}
				>
					Copy
				</MenuItem>
			</MenuContent>
		</ContextMenu>
	);
}
