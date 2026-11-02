import {type MouseEvent, type ReactNode, useCallback, useEffect, useRef, useState} from "react";

import {writeClipboardText} from "../../lib/clipboard";
import {attachContext} from "../../lib/context-attach";
import {type DiffSide, openDiffCommentDraft} from "../../lib/diff-comments";
import {detectLanguage} from "../../lib/diff-utils";
import {useToast} from "../toast-context";
import {SELECTION_BAR_CLASS, SelectionBarButton} from "../transcript-selection-bar";
import {findScrollContainer} from "../scroll-container";
import {ContextMenu, ContextMenuTrigger, MenuContent, MenuItem, MenuSeparator} from "../ui/menu";
import {useAnyMenuOpen} from "../ui/menu-open-count";

/** The diff lines a right-click lands on: the selection inside the diff, or the clicked line. */
interface DiffLineSelection
{
	side: DiffSide;
	line: number;
	endLine: number;
	text: string;
}

function rowSide(row: Element): DiffSide
{
	switch (row.getAttribute("data-line-type"))
	{
		case "change-deletion":
			return "deletions";
		case "change-addition":
			return "additions";
		default:
			return row.closest("[data-code]")?.hasAttribute("data-deletions") ? "deletions" : "additions";
	}
}

function rowText(row: Element): string
{
	return row.textContent.replace(/\n$/, "");
}

/** The code row for a node inside the diff: a `[data-line]` row, or the row a line number labels. */
function rowOf(node: Node | null): Element | null
{
	const element = node instanceof Element ? node : (node?.parentElement ?? null);
	const row = element?.closest("[data-line], [data-column-number]") ?? null;
	if (row === null || row.hasAttribute("data-line")) return row;
	const index = row.getAttribute("data-line-index");
	const code = row.closest("[data-code]");
	if (index === null || code === null) return null;
	return code.querySelector(`[data-line][data-line-index="${CSS.escape(index)}"]`);
}

/** Every diff row from `first` to `last` in document order, across both columns of a split diff. */
function rowsBetween(root: ShadowRoot, first: Element, last: Element): Element[]
{
	const rows = [...root.querySelectorAll("[data-line]")];
	const [from, to] = [rows.indexOf(first), rows.indexOf(last)].toSorted((x, y) => x - y);
	if (from === undefined || to === undefined || from === -1) return [last];
	return rows.slice(from, to + 1);
}

function selectionIn(root: ShadowRoot): Selection | null
{
	const scoped = (
		root as ShadowRoot &
		{
			getSelection?: () => Selection | null;
		}
	).getSelection;
	const selection = typeof scoped === "function" ? scoped.call(root) : document.getSelection();
	if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return null;
	const node = selection.getRangeAt(0).commonAncestorContainer;
	return node.getRootNode() === root ? selection : null;
}

/**
 * Upstream `p`: the addition rows if any were selected, else the deletion rows; none for a
 * split diff selection that spans both columns.
 */
function spanOf(root: ShadowRoot, rows: Element[]): DiffLineSelection | null
{
	const additions = rows.filter((row) => rowSide(row) === "additions");
	const deletions = rows.filter((row) => rowSide(row) === "deletions");
	const split = root.querySelector("[data-deletions], [data-additions]") !== null;
	if (split && additions.length > 0 && deletions.length > 0) return null;
	const side: DiffSide = additions.length > 0 ? "additions" : "deletions";
	const numbered = (side === "additions" ? additions : deletions)
		.map((row) => (
		{
			row,
			line: Number(row.getAttribute("data-line")),
		}))
		.filter(({line}) => Number.isSafeInteger(line))
		.toSorted((x, y) => x.line - y.line);
	const first = numbered[0];
	const last = numbered.at(-1);
	if (first === undefined || last === undefined) return null;
	return {
		side,
		line: first.line,
		endLine: last.line,
		text: numbered.map(({row}) => rowText(row)).join("\n"),
	};
}

function sameSpan(a: DiffLineSelection, b: DiffLineSelection): boolean
{
	return a.line === b.line && a.endLine === b.endLine && a.side === b.side;
}

/** Upstream's "line N" / "lines A–B" for a comment's accessible name. */
function linesLabel({line, endLine}: DiffLineSelection): string
{
	return line === endLine ? `line ${line}` : `lines ${line}–${endLine}`;
}

/** The diff row an event lands on, through the `@pierre/diffs` shadow root. */
function eventRow(event: MouseEvent): Element | null
{
	const path = event.nativeEvent.composedPath();
	return rowOf(path.find((target): target is Element => target instanceof Element) ?? null);
}

/** The rows a selection inside `root` spans, or null without one. */
function selectedRows(root: ShadowRoot): Element[] | null
{
	const selection = selectionIn(root);
	if (selection === null) return null;
	const anchor = rowOf(selection.anchorNode);
	const focus = rowOf(selection.focusNode);
	if (anchor === null || focus === null) return null;
	return rowsBetween(root, anchor, focus);
}

/** Upstream `Cr`: the span the selection inside `root` covers, or null. */
function selectionSpan(root: ShadowRoot): DiffLineSelection | null
{
	const rows = selectedRows(root);
	return rows === null ? null : spanOf(root, rows);
}

/** Resolves a right-click inside a `@pierre/diffs` shadow root to diff lines. */
function diffLinesAt(event: MouseEvent): DiffLineSelection | null
{
	const clicked = eventRow(event);
	const root = clicked?.getRootNode();
	if (clicked === null || !(root instanceof ShadowRoot)) return null;
	const rows = selectedRows(root);
	return (rows?.includes(clicked) ? spanOf(root, rows) : null) ?? spanOf(root, [clicked]);
}

/** Upstream `Vd`: the gap between the pointer and the chip. */
const CHIP_GAP = 8;
/** Upstream `Bd`: the pointer x is clamped this far inside the wrapper so the chip never clips. */
const CHIP_EDGE = 72;
/** Upstream `Hd`: a release this close to the scroller's top flips the chip below the pointer. */
const CHIP_FLIP_ZONE = 48;
/** Upstream `zd`: a double or triple click waits this long for its word or line selection to settle. */
const MULTI_CLICK_DELAY = 250;
/** Upstream `Kd`: how far the diff host may move before the chip counts as scrolled away. */
const HOST_MOVE_TOLERANCE = 1;
/** Upstream's layer base + 4 inside the pane: above the diff rows, below the menus. */
const CHIP_Z_INDEX = 4;

/** The floating chip over a diff selection, placed in the file wrapper's coordinates. */
interface SelectionChip
{
	root: ShadowRoot;
	host: Element;
	lines: DiffLineSelection;
	x: number;
	y: number;
	flipBelow: boolean;
	hostTop: number;
}

/** Upstream `Gd`: the top of the nearest scrolling ancestor, or 0 when the document scrolls. */
function scrollerTop(host: Element): number
{
	const scroller = findScrollContainer(host);
	return scroller === document.scrollingElement || scroller === document.documentElement
		? 0
		: scroller.getBoundingClientRect().top;
}

/** Upstream `ie`: the chip anchored to the pointer, clamped inside the wrapper, flipped below near the scroller's top. */
function chipAt(wrapper: Element, host: Element, clientX: number, clientY: number): SelectionChip | null
{
	const root = host.shadowRoot;
	const lines = root === null ? null : selectionSpan(root);
	if (root === null || lines === null) return null;
	const bounds = wrapper.getBoundingClientRect();
	return {
		root,
		host,
		lines,
		x: Math.min(Math.max(clientX - bounds.left, CHIP_EDGE), Math.max(bounds.width - CHIP_EDGE, CHIP_EDGE)),
		y: clientY - bounds.top,
		flipBelow: clientY - scrollerTop(host) < CHIP_FLIP_ZONE,
		hostTop: host.getBoundingClientRect().top,
	};
}

/** Upstream `_r`: the `diffs-container` host a mouse-up landed in, outside any file header. */
function diffHostOf(target: EventTarget | null): Element | null
{
	if (!(target instanceof Element) || target.closest("[data-diff-file-header]") !== null) return null;
	return target.closest("diffs-container");
}

function isEditable(element: Element | null): boolean
{
	return (
		element instanceof HTMLInputElement ||
		element instanceof HTMLTextAreaElement ||
		(element instanceof HTMLElement && element.isContentEditable)
	);
}

/** Upstream `Wd`: another dialog or popup (a menu included) owns Escape. */
function dialogOpen(): boolean
{
	return document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]') !== null;
}

/** Hides the chip on Escape, a wheel, a scroll that moves the host, or a selection of other lines. */
function useChipDismissal(chip: SelectionChip | null, hide: () => void)
{
	useEffect(() =>
	{
		if (chip === null) return undefined;
		const recheck = () =>
		{
			const lines = selectionSpan(chip.root);
			if (lines === null || !sameSpan(lines, chip.lines)) hide();
		};
		const onKeyDown = (event: KeyboardEvent) =>
		{
			if (event.key !== "Escape" || event.isComposing) return;
			if (isEditable(document.activeElement) || dialogOpen()) return;
			event.preventDefault();
			event.stopPropagation();
			hide();
		};
		const onScroll = () =>
		{
			if (Math.abs(chip.host.getBoundingClientRect().top - chip.hostTop) > HOST_MOVE_TOLERANCE) hide();
			else recheck();
		};
		document.addEventListener("selectionchange", recheck);
		document.addEventListener("keydown", onKeyDown, true);
		document.addEventListener(
			"wheel",
			hide,
			{
				capture: true,
				passive: true,
			},
		);
		window.addEventListener(
			"scroll",
			onScroll,
			{
				capture: true,
				passive: true,
			},
		);
		return () =>
		{
			document.removeEventListener("selectionchange", recheck);
			document.removeEventListener("keydown", onKeyDown, true);
			document.removeEventListener("wheel", hide, true);
			window.removeEventListener("scroll", onScroll, true);
		};
	}, [chip, hide]);
}

/** A double or triple click's deferred chip: the timer and the wheel listener that cancels it. */
function usePendingChip()
{
	const cancelRef = useRef<(() => void) | null>(null);
	const cancel = () =>
	{
		cancelRef.current?.();
		cancelRef.current = null;
	};
	useEffect(() => cancel, []);
	const defer = (run: () => void) =>
	{
		cancel();
		const timer = setTimeout(() =>
		{
			cancel();
			run();
		}, MULTI_CLICK_DELAY);
		document.addEventListener(
			"wheel",
			cancel,
			{
				capture: true,
				passive: true,
			},
		);
		cancelRef.current = () =>
		{
			clearTimeout(timer);
			document.removeEventListener("wheel", cancel, true);
		};
	};
	return {
		defer,
		cancel,
	};
}

/**
 * The Changes pane body's right-click menu, as on claude.ai/code:
 * Attach as context · Add comment · ─ · Copy ⌘C.
 */
export function DiffContextMenu({sessionId, path, children}: {sessionId: string; path: string; children: ReactNode})
{
	const [target, setTarget] = useState<DiffLineSelection | null>(null);
	const [chip, setChip] = useState<SelectionChip | null>(null);
	const toast = useToast();
	const menuOpen = useAnyMenuOpen();
	const pending = usePendingChip();
	const hideChip = useCallback(() =>
	{
		setChip(null);
	}, []);
	useChipDismissal(chip, hideChip);

	function comment(lines: DiffLineSelection)
	{
		const lang = detectLanguage(path);
		openDiffCommentDraft(
			sessionId,
			{
				path,
				side: lines.side,
				line: lines.line,
				endLine: lines.endLine,
				...(lines.text === ""
					? {}
					:
						{
							snippet: lines.text,
						}),
				...(lang === null
					? {}
					:
						{
							lang,
						}),
			},
		);
	}

	function attach(lines: DiffLineSelection)
	{
		const attached = attachContext(
			sessionId,
			{
				kind: "selection",
				path,
				range:
				{
					start: lines.line,
					end: lines.endLine,
				},
				text: lines.text,
				language: detectLanguage(path),
			},
		);
		if (!attached)
		{
			toast(
				{
					kind: "error",
					message: "Open the chat input to attach context.",
				},
			);
		}
	}

	function copy(lines: DiffLineSelection)
	{
		void writeClipboardText(lines.text).then((copied) =>
		{
			toast(
				copied
					?
						{
							kind: "success",
							message: "Copied to clipboard.",
						}
					:
						{
							kind: "error",
							message: "Couldn’t copy the selection.",
						},
			);
		});
	}

	return (
		<ContextMenu>
			<ContextMenuTrigger
				render={<div className="relative" />}
				onContextMenu={(event: MouseEvent) =>
				{
					pending.cancel();
					setChip(null);
					setTarget(diffLinesAt(event));
				}}
				onMouseUp={(event: MouseEvent<HTMLElement>) =>
				{
					pending.cancel();
					// Upstream `U`: only a primary release inside a diff (not on a file header or the chip) places it.
					const host = diffHostOf(event.target);
					if (event.button !== 0 || host === null) return;
					const wrapper = event.currentTarget;
					const {clientX, clientY} = event;
					if (event.detail < 2)
					{
						setChip(chipAt(wrapper, host, clientX, clientY));
						return;
					}
					const pressTop = host.getBoundingClientRect().top;
					pending.defer(() =>
					{
						if (Math.abs(host.getBoundingClientRect().top - pressTop) > HOST_MOVE_TOLERANCE) return;
						setChip(chipAt(wrapper, host, clientX, clientY));
					});
				}}
			>
				{children}
				{chip !== null && (
					<div
						className="absolute isolate"
						data-pane-editor=""
						style={
						{
							left: chip.x,
							top: chip.y,
							transform: chip.flipBelow
								? `translate(-50%, ${CHIP_GAP}px)`
								: `translate(-50%, calc(-100% - ${CHIP_GAP}px))`,
							zIndex: CHIP_Z_INDEX,
						}}
					>
						<div
							data-surface="popover"
							className={SELECTION_BAR_CLASS}
							style={
								menuOpen
									?
										{
											visibility: "hidden",
										}
									: undefined
							}
						>
							<SelectionBarButton
								aria-label={`Add comment on ${linesLabel(chip.lines)}`}
								onMouseDown={(event) =>
								{
									event.preventDefault();
								}}
								onClick={() =>
								{
									comment(chip.lines);
									selectionIn(chip.root)?.removeAllRanges();
									setChip(null);
								}}
							>
								Add comment
							</SelectionBarButton>
						</div>
					</div>
				)}
			</ContextMenuTrigger>
			<MenuContent>
				<MenuItem
					disabled={target === null}
					onSelect={() =>
					{
						if (target) attach(target);
					}}
				>
					Attach as context
				</MenuItem>
				<MenuItem
					disabled={target === null}
					{...(target === null
						? {}
						:
							{
								"aria-label": `Add comment on ${linesLabel(target)}`,
							})}
					onSelect={() =>
					{
						if (target) comment(target);
					}}
				>
					Add comment
				</MenuItem>
				<MenuSeparator />
				<MenuItem
					shortcut="cmd+c"
					disabled={target === null}
					onSelect={() =>
					{
						if (target) copy(target);
					}}
				>
					Copy
				</MenuItem>
			</MenuContent>
		</ContextMenu>
	);
}
