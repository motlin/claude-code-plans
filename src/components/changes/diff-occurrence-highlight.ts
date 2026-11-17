import {type RefObject, useEffect} from "react";
import {intersects, selectionRangeIn} from "../../lib/diff-copy";
import {textRanges} from "../files/find-highlights";
import {adoptDiffSheet} from "./diff-rails";

/*
 * claude.ai/code's Changes pane occurrence highlight (c44d00c7f `jl`/`Al`/`Dl`/`Ol`): select text inside one
 * diff row and, 100ms later, every other occurrence in the pane's diffs gets a faint selection-match paint.
 */

/** Upstream `Sl`. */
export const OCCURRENCE_HIGHLIGHT = "epitaxy-diff-occurrence";
/** Upstream `yl`. */
export const OCCURRENCE_MAX_CHARS = 200;
/** Upstream `bl`: past this many ranges the whole highlight is dropped. */
export const OCCURRENCE_MAX_MATCHES = 100;
/** Upstream `Dl`'s per-row `.slice(0,103)`. */
export const OCCURRENCE_ROW_CAP = 103;
/** Upstream `xl`. */
export const OCCURRENCE_DEBOUNCE_MS = 100;
/** Upstream `Pc`: the top-level diff hosts. */
export const DIFF_HOST_SELECTOR = "diffs-container:not(diffs-container diffs-container)";
/** Upstream `Cl`'s rule; the fallbacks are c5d464fa3's claude-light/claude-dark `selectionMatch`. */
export const OCCURRENCE_CSS = `::highlight(${OCCURRENCE_HIGHLIGHT}){background-color:var(--code-theme-selection-match-bg,light-dark(#0073e61a,#0099ff24))}`;

/** Upstream `Cl`. */
export const adoptOccurrenceSheet = adoptDiffSheet(OCCURRENCE_CSS);

export interface OccurrenceState
{
	owner: RefObject<Element | null>;
	scope: Element;
	text: string;
	own: Range;
	isPaintQueued?: boolean;
}

/** Upstream `wl`: at most one active state per window. */
const states = new WeakMap<Window, OccurrenceState>();

/** Upstream `El(window)`; this app has one window, so its globals stand in for the window's. */
function registry(): HighlightRegistry | undefined
{
	return typeof CSS !== "undefined" && "highlights" in CSS ? CSS.highlights : undefined;
}

function highlightClass(): typeof Highlight | undefined
{
	return typeof Highlight === "undefined" ? undefined : Highlight;
}

/** Upstream `Tl`: the user's own range was collapsed or its row unmounted. */
function isStale({own}: OccurrenceState): boolean
{
	return own.collapsed || !own.startContainer.isConnected;
}

/** Upstream `kl`. */
function rowOf(node: Node): Element | null
{
	const element = node instanceof Element ? node : node.parentElement;
	return element?.closest("[data-line]") ?? null;
}

/** Upstream c5fbdc8eb `ce` with `{matchCase:true, wholeWord:false, regexp:false}`: a plain substring search. */
function substringMatches(text: string):
	| ((haystack: string) =>
	  {
			start: number;
			end: number;
	  }[])
	| null
{
	if (text.length === 0 || text.includes("\n")) return null;
	return (haystack) =>
	{
		const found:
		{
			start: number;
			end: number;
		}[] = [];
		for (let at = haystack.indexOf(text); at !== -1; at = haystack.indexOf(text, at + text.length))
		{
			found.push(
				{
					start: at,
					end: at + text.length,
				},
			);
		}
		return found;
	};
}

/**
 * Upstream `Al`: the first top-level host holding the selection decides. A selection spanning rows, longer
 * than 200 chars once trimmed, or blank gives null (clear); no selection in any host gives undefined.
 */
export function occurrenceStateFrom(
	owner: RefObject<Element | null>,
	scope: Element,
	selection: Selection,
): OccurrenceState | null | undefined
{
	for (const host of scope.querySelectorAll(DIFF_HOST_SELECTOR))
	{
		const range = host.shadowRoot && selectionRangeIn(host.shadowRoot, selection);
		if (!range) continue;
		const row = rowOf(range.startContainer);
		if (row === null || row !== rowOf(range.endContainer)) return null;
		const own = host.ownerDocument.createRange();
		own.setStart(range.startContainer, range.startOffset);
		own.setEnd(range.endContainer, range.endOffset);
		const text = own.toString().trim();
		if (text.length > OCCURRENCE_MAX_CHARS || substringMatches(text) === null) return null;
		return {
			owner,
			scope,
			text,
			own,
		};
	}
	return undefined;
}

function textNodesOf(row: Element): Text[]
{
	const walker = row.ownerDocument.createTreeWalker(row, NodeFilter.SHOW_TEXT);
	const nodes: Text[] = [];
	for (let node = walker.nextNode(); node !== null; node = walker.nextNode())
	{
		if (node instanceof Text) nodes.push(node);
	}
	return nodes;
}

/** Upstream `Dl`. */
export function paintOccurrences(state: OccurrenceState): void
{
	const HighlightClass = highlightClass();
	const match = substringMatches(state.text);
	if (HighlightClass === undefined || match === null) return;
	const highlight = new HighlightClass();
	highlight.priority = -1;
	for (const host of state.scope.querySelectorAll(DIFF_HOST_SELECTOR))
	{
		adoptOccurrenceSheet(host);
		for (const row of host.shadowRoot?.querySelectorAll("[data-line]") ?? [])
		{
			if (!row.textContent.includes(state.text)) continue;
			const [first, ...rest] = textNodesOf(row);
			if (first === undefined) continue;
			const ownRow = state.own.intersectsNode(row);
			for (const range of textRanges([first, ...rest], (joined) => match(joined).slice(0, OCCURRENCE_ROW_CAP)))
			{
				if (!ownRow || !intersects(range, state.own)) highlight.add(range);
			}
			if (highlight.size > OCCURRENCE_MAX_MATCHES)
			{
				registry()?.delete(OCCURRENCE_HIGHLIGHT);
				return;
			}
		}
	}
	registry()?.set(OCCURRENCE_HIGHLIGHT, highlight);
}

/** Upstream `Ol`: a diff host rendered; repaint once in a microtask if it sits in the active scope. */
export function requestOccurrenceRepaint(host: Element): void
{
	const win = host.ownerDocument.defaultView;
	const state = win === null ? undefined : states.get(win);
	if (win === null || !state || state.isPaintQueued || !state.scope.contains(host)) return;
	state.isPaintQueued = true;
	queueMicrotask(() =>
	{
		state.isPaintQueued = false;
		if (states.get(win) === state) paintOccurrences(state);
	});
}

/** Upstream `jl(scopeRef, key)`: `key` re-arms the effect when the session or diff scope changes. */
export function useDiffOccurrenceHighlight(scopeRef: RefObject<Element | null>, key: string): void
{
	useEffect(() =>
	{
		const win = typeof window === "undefined" ? undefined : window;
		if (win === undefined || highlightClass() === undefined) return undefined;
		let timer: number | undefined;
		const mine = (): OccurrenceState | undefined =>
		{
			const state = states.get(win);
			return state?.owner === scopeRef ? state : undefined;
		};
		const clear = (): void =>
		{
			if (!mine()) return;
			states.delete(win);
			registry()?.delete(OCCURRENCE_HIGHLIGHT);
		};
		const update = (): void =>
		{
			const scope = scopeRef.current;
			const selection = win.getSelection();
			const next = scope && selection && occurrenceStateFrom(scopeRef, scope, selection);
			const previous = mine();
			if (next)
			{
				states.set(win, next);
				paintOccurrences(next);
			}
			else if (next === null || !(previous && isStale(previous)) || selection?.toString())
			{
				clear();
			}
		};
		const onSelectionChange = (): void =>
		{
			win.clearTimeout(timer);
			timer = win.setTimeout(update, OCCURRENCE_DEBOUNCE_MS);
		};
		const onPointerDown = (event: PointerEvent): void =>
		{
			const state = mine();
			const path = event.composedPath();
			const [target] = path;
			const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
			if (
				event.button === 0 &&
				state &&
				isStale(state) &&
				(element?.closest("[data-line]") || !path.includes(state.scope))
			)
			{
				clear();
			}
		};
		const doc = win.document;
		doc.addEventListener("selectionchange", onSelectionChange);
		doc.addEventListener("pointerdown", onPointerDown, true);
		return () =>
		{
			doc.removeEventListener("selectionchange", onSelectionChange);
			doc.removeEventListener("pointerdown", onPointerDown, true);
			win.clearTimeout(timer);
			clear();
		};
	}, [scopeRef, key]);
}
