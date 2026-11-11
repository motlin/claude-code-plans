/**
 * Upstream's tile content-host registry (c9bc99274 class `_`, one per tiles root). Every tile's content is portalled
 * into a persistent `div[data-tile-host]` (`display:contents`) that the tile's shell adopts, so the layout tree can
 * re-parent, split, collapse or reorder tiles without unmounting the pane. Between a shell's unmount and the next
 * adopt the host waits in an off-screen inert pen (only when `moveBefore` keeps its state across the move), and each
 * host remembers its scrolled elements, focus and caret to restore after a move.
 */

import {setScrollTop} from "./scroll-setter";

const HOST_ATTRIBUTE = "data-tile-host";
const PEN_ATTRIBUTE = "data-tile-host-pen";
const PEN_STYLE =
	"position:fixed;top:0;left:calc(100vw + 10000px);visibility:hidden;pointer-events:none;contain:layout";
const PEN_CELL_STYLE =
	"position:absolute;top:0;left:0;display:grid;grid-template-rows:minmax(0,1fr);grid-template-columns:minmax(0,1fr)";
const HOST_STYLE = "display:contents";
/** Upstream `l`: the per-host ring of remembered scrollers. */
const SCROLL_MEMORY_SIZE = 32;
/** Upstream `atBottom`: within 2px of the bottom. */
const AT_BOTTOM_SLOP_PX = 2;

export interface TileBox {
	width: number;
	height: number;
}

type Focusable = Element & HTMLOrSVGElement;
type Caret = readonly [anchor: Node, anchorOffset: number, focus: Node, focusOffset: number];

interface ScrollEntry {
	el: Element;
	top: number;
	left: number;
	atBottom: boolean;
}

interface PendingRestore {
	focused: Focusable | null;
	caret: Caret | null;
	scrolls: ScrollEntry[];
}

interface ScrollMemory {
	entries: () => Element[];
	dispose: () => void;
}

interface HostRecord {
	host: HTMLDivElement;
	scrollMemory: ScrollMemory;
	pending: PendingRestore | null;
	frozen: ScrollEntry[] | null;
	frozenBox: TileBox | null;
	/** The pen cell holding the host while parked. */
	cell: HTMLDivElement | null;
	dispose: () => void;
}

export class TileContentHosts {
	private readonly records = new Map<string, HostRecord>();
	private penEl: HTMLDivElement | null = null;
	private liveIds: ReadonlySet<string> | null = null;
	private readonly canMove: boolean;

	constructor(private readonly doc: Document) {
		this.canMove =
			typeof (doc.createElement("div") as Partial<Pick<Element, "moveBefore">>).moveBefore === "function";
	}

	host(id: string): HTMLDivElement {
		return this.record(id).host;
	}

	/** Moves the tile's host into `cell` and restores its snapshot; the cleanup snapshots and parks it again. */
	adopt(id: string, cell: Element, box?: TileBox): () => void {
		const record = this.record(id);
		const {host} = record;
		this.place(record, cell);
		restore(record);
		return () => {
			if (host.parentNode !== cell) return;
			snapshot(record);
			this.park(id, record, box);
		};
	}

	/**
	 * Snapshots a host whose cell React is about to move in place (upstream's orderKey effect cleanup). With
	 * `parkIframes` (a sibling moves ahead of the tile), a host holding an iframe is parked first, so React's move of
	 * the cell never reloads the frame.
	 */
	slotWillMove(id: string, cell: Element, parkIframes = false): void {
		const record = this.records.get(id);
		if (record?.host.parentNode !== cell) return;
		snapshot(record);
		if (parkIframes && record.host.querySelector("iframe") !== null) this.park(id, record, undefined);
	}

	/** Restores a host after its cell moved in place, re-placing it if it was parked meanwhile. */
	slotMoved(id: string, cell: Element): void {
		const record = this.records.get(id);
		if (record === undefined) return;
		const wasParked = record.cell !== null;
		if (wasParked) this.place(record, cell);
		if (record.pending !== null && record.host.parentNode === cell) restore(record, wasParked);
	}

	/** Upstream `Ct` getSnapshotBeforeUpdate: records every host's scrolls and box before a structural change. */
	freezeScrolls(liveIds?: ReadonlySet<string>): void {
		this.liveIds = liveIds ?? null;
		for (const record of this.records.values()) {
			const parent = record.host.isConnected ? record.host.parentElement : null;
			record.frozen = parent === null ? null : readScrolls(record.scrollMemory);
			record.frozenBox = parent === null ? null : {width: parent.clientWidth, height: parent.clientHeight};
		}
	}

	thawScrolls(): void {
		this.liveIds = null;
		for (const record of this.records.values()) {
			record.frozen = null;
			record.frozenBox = null;
		}
	}

	/** Disposes the hosts of tiles no longer live and drops an empty pen. */
	retain(liveIds: ReadonlySet<string>): void {
		for (const [id, record] of this.records) {
			if (liveIds.has(id)) continue;
			record.dispose();
			this.records.delete(id);
		}
		if (this.penEl?.childElementCount === 0) {
			this.penEl.remove();
			this.penEl = null;
		}
	}

	/** On unmount: removes parked hosts whose portal content is gone, then the pen once empty. */
	releaseParked(): void {
		const pen = this.penEl;
		if (pen === null) return;
		for (const record of this.records.values()) {
			if (record.cell !== null && record.host.firstChild === null) {
				record.host.remove();
				dropEmptyCell(record);
			}
		}
		if (pen.childElementCount === 0) {
			pen.remove();
			this.penEl = null;
		}
	}

	private place(record: HostRecord, cell: Element): void {
		const {host} = record;
		if (host.parentNode !== cell) {
			if (this.canMoveInto(cell, host)) cell.moveBefore(host, null);
			else cell.appendChild(host);
		}
		dropEmptyCell(record);
	}

	private park(id: string, record: HostRecord, box: TileBox | undefined): void {
		const {host} = record;
		const pen = this.pen();
		if (pen === null || !this.canMoveInto(pen, host)) return;
		const cell = this.doc.createElement("div");
		cell.setAttribute("style", PEN_CELL_STYLE);
		const frozen = record.frozenBox;
		const size = frozen !== null && frozen.width > 0 && frozen.height > 0 ? frozen : box;
		if (size !== undefined && size.width > 0 && size.height > 0) {
			cell.style.width = `${size.width}px`;
			cell.style.height = `${size.height}px`;
		} else {
			cell.style.display = "none";
		}
		if (this.liveIds?.has(id) === false) cell.style.setProperty("content-visibility", "hidden");
		pen.appendChild(cell);
		record.cell = cell;
		cell.moveBefore(host, null);
	}

	private canMoveInto(parent: Element, node: Element): boolean {
		return this.canMove && node.isConnected && parent.isConnected && parent.ownerDocument === node.ownerDocument;
	}

	private pen(): HTMLDivElement | null {
		if (!this.canMove) return null;
		if (this.penEl?.isConnected === true) return this.penEl;
		const pen = this.doc.createElement("div");
		pen.setAttribute(PEN_ATTRIBUTE, "");
		pen.setAttribute("style", PEN_STYLE);
		pen.setAttribute("inert", "");
		this.doc.body.appendChild(pen);
		this.penEl = pen;
		return pen;
	}

	private record(id: string): HostRecord {
		const existing = this.records.get(id);
		if (existing) return existing;
		const host = this.doc.createElement("div");
		host.setAttribute(HOST_ATTRIBUTE, id);
		host.setAttribute("style", HOST_STYLE);
		const scrollMemory = rememberScrollers(host);
		const record: HostRecord = {
			host,
			scrollMemory,
			pending: null,
			frozen: null,
			frozenBox: null,
			cell: null,
			dispose: () => {
				scrollMemory.dispose();
				host.remove();
				dropEmptyCell(record);
			},
		};
		this.records.set(id, record);
		return record;
	}
}

/**
 * Upstream `yt`: whether an in-place move puts a sibling ahead of the tile that was not ahead before. Keys are
 * `/`-joined levels of `,`-joined node ids: `orderKey` lists the tile's parents' children, `aheadKey` the ones before it.
 */
export function siblingMovedAhead(orderKey: string, aheadKey: string, nextAheadKey: string): boolean {
	const order = orderKey.split("/");
	const ahead = aheadKey.split("/");
	return nextAheadKey.split("/").some((level, index) => {
		const wasAhead = ahead.at(index)?.split(",");
		const siblings = order.at(index)?.split(",");
		return (
			wasAhead === undefined ||
			siblings === undefined ||
			level.split(",").some((id) => siblings.includes(id) && !wasAhead.includes(id))
		);
	});
}

/** Upstream `v`: a capture-phase scroll listener keeping the last 32 distinct scrolled elements (weakly). */
function rememberScrollers(host: Element): ScrollMemory {
	const seen = new WeakSet<Element>();
	let ring: Array<WeakRef<Element>> = [];
	const entries = () => {
		const live: Element[] = [];
		const kept: Array<WeakRef<Element>> = [];
		for (const ref of ring) {
			const element = ref.deref();
			if (element === undefined) continue;
			if (host.contains(element)) {
				live.push(element);
				kept.push(ref);
			} else {
				seen.delete(element);
			}
		}
		ring = kept;
		return live;
	};
	const onScroll = (event: Event) => {
		const target = event.target;
		if (!(target instanceof Element) || seen.has(target)) return;
		entries();
		if (ring.length >= SCROLL_MEMORY_SIZE) {
			const oldest = ring.shift()?.deref();
			if (oldest !== undefined) seen.delete(oldest);
		}
		seen.add(target);
		ring.push(new WeakRef(target));
	};
	host.addEventListener("scroll", onScroll, {capture: true, passive: true});
	return {
		entries,
		dispose: () => {
			host.removeEventListener("scroll", onScroll, {capture: true});
			ring = [];
		},
	};
}

function focusFellToBody(doc: Document): boolean {
	const active = doc.activeElement;
	return active === null || active === doc.body || active === doc.documentElement;
}

function holdsFocusWithin(host: Element): boolean {
	const active = host.ownerDocument.activeElement;
	return active !== null && active !== host && host.contains(active);
}

function isFocusable(element: Element | null): element is Focusable {
	return element !== null && "focus" in element && typeof element.focus === "function";
}

function dropEmptyCell(record: HostRecord): void {
	const {cell} = record;
	if (cell !== null && !cell.contains(record.host)) {
		cell.remove();
		record.cell = null;
	}
}

/** Upstream `D`: the focused element, its caret and the (frozen, else live) scrolls, to restore after the move. */
function snapshot(record: HostRecord): void {
	const {host, scrollMemory, frozen} = record;
	const active = host.ownerDocument.activeElement;
	const focused = holdsFocusWithin(host) && isFocusable(active) ? active : null;
	record.pending = {focused, caret: caretOf(focused), scrolls: frozen ?? readScrolls(scrollMemory)};
}

/** Upstream `O`: the selection, when both of its ends sit inside the focused element. */
function caretOf(element: Element | null): Caret | null {
	const selection = element?.ownerDocument.getSelection();
	if (!element || !selection) return null;
	const {anchorNode, anchorOffset, focusNode, focusOffset} = selection;
	return anchorNode !== null && focusNode !== null && element.contains(anchorNode) && element.contains(focusNode)
		? [anchorNode, anchorOffset, focusNode, focusOffset]
		: null;
}

function nodeLength(node: Node): number {
	return node.nodeValue?.length ?? node.childNodes.length;
}

/** Upstream `A`: every remembered scroller off its origin, with whether it sat at the bottom. */
function readScrolls(memory: ScrollMemory): ScrollEntry[] {
	const scrolls: ScrollEntry[] = [];
	for (const el of memory.entries()) {
		if (el.scrollTop === 0 && el.scrollLeft === 0) continue;
		const atBottom =
			el.scrollHeight > el.clientHeight && el.scrollHeight - el.clientHeight - el.scrollTop <= AT_BOTTOM_SLOP_PX;
		scrolls.push({el, top: el.scrollTop, left: el.scrollLeft, atBottom});
	}
	return scrolls;
}

/**
 * Upstream `j`: pins at-bottom scrollers to the new bottom, reapplies offsets a move reset (or, after a park, lowered),
 * then refocuses the remembered element when focus fell to the body and reapplies its caret.
 */
function restore(record: HostRecord, wasParked = false): void {
	const {host, pending} = record;
	record.pending = null;
	if (!pending || !host.isConnected) return;
	for (const {el, top, left, atBottom} of pending.scrolls) {
		if (!host.contains(el)) continue;
		if (atBottom && el.scrollTop < top) {
			const bottom = el.scrollHeight - el.clientHeight;
			if (bottom - el.scrollTop > AT_BOTTOM_SLOP_PX) setScrollTop(el, bottom);
		} else if (top !== 0 && (el.scrollTop === 0 || (wasParked && el.scrollTop < top))) {
			setScrollTop(el, top);
		}
		if (left !== 0 && el.scrollLeft === 0) el.scrollLeft = left;
	}
	const {focused, caret} = pending;
	if (focused && focusFellToBody(host.ownerDocument) && host.contains(focused)) focused.focus({preventScroll: true});
	if (focused && caret) restoreCaret(focused, caret);
}

/** Upstream `M`: reapplies the caret, clamped to the nodes' lengths, unless the selection is already inside. */
function restoreCaret(element: Element, [anchor, anchorOffset, focus, focusOffset]: Caret): void {
	const selection = element.ownerDocument.getSelection();
	if (
		selection === null ||
		element.ownerDocument.activeElement !== element ||
		!element.contains(anchor) ||
		!element.contains(focus) ||
		(element.contains(selection.anchorNode) && element.contains(selection.focusNode))
	)
		return;
	selection.setBaseAndExtent(
		anchor,
		Math.min(anchorOffset, nodeLength(anchor)),
		focus,
		Math.min(focusOffset, nodeLength(focus)),
	);
}
