import {createContext, type PointerEvent, useContext, useMemo, useRef} from "react";

import {rawAt, release, type SheetDetent, type SheetGeometry, follow, sheetGeometry} from "../../lib/sheet-drag";

/** Upstream's Gf: the tall detent is .9 of the viewport below the top safe area. */
const TALL_FRACTION = 0.9;

/** Upstream's yk: the tall detent's height. */
export const SHEET_TALL_HEIGHT = "calc((100dvh - env(safe-area-inset-top,0px)) * .9)";

/** Upstream's H4: where a dismissed sheet slides to. */
const SHEET_OFFSCREEN = "calc(100% + 1.5rem)";

/** Never start a drag on a control: rows, links and fields keep their own press. */
const NO_DRAG_TARGET = 'button, a, input, textarea, [role="menuitem"], [role="option"], [data-cds-sheet-control]';

/** Upstream's td: the text-entry controls that floor a sheet at half height and summon the keyboard. */
export const SHEET_TEXT_ENTRY =
	'input:not([type=button],[type=checkbox],[type=radio],[type=range],[type=submit],[type=reset],[type=color],[type=file],[type=image],[type=hidden],[readonly]), textarea:not([readonly]), [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]';

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** The root sheet's frame: its tree, how to close it, and the detent the drag can move it to. */
export interface SheetDragFrame {
	treeId: string;
	dismiss: () => void;
	detent: SheetDetent;
	setDetent: (detent: SheetDetent) => void;
	/** True while the on-screen keyboard lifts the sheet; upstream's drag never starts then. */
	keyboard?: boolean;
}

export const SheetDragContext = createContext<SheetDragFrame | null>(null);

interface DraggedLevel {
	el: HTMLElement;
	height: string;
}

interface Drag extends SheetGeometry {
	pointerId: number;
	startY: number;
	lastY: number;
	lastT: number;
	velocity: number;
	detent: SheetDetent;
	raw: number;
	caughtSlide: number;
	levels: DraggedLevel[];
	scrims: HTMLElement[];
}

/** Upstream's lt: write the followed height, slide and scrim opacity onto every level. */
function applyDrag(drag: Drag, dy: number) {
	const {height, slide, shown} = follow(drag, drag.raw - dy);
	for (const {el} of drag.levels) {
		el.style.height = `${height}px`;
		el.style.translate = slide > 0 ? `0 ${slide}px` : "";
	}
	const opacity = shown < 1 ? shown.toFixed(3) : "";
	for (const scrim of drag.scrims) {
		if (scrim.style.opacity !== opacity) scrim.style.opacity = opacity;
	}
}

/** Upstream's K: hand the levels back to CSS, leaving dismissed levels off-screen for the exit. */
function endDrag(drag: Drag, dismiss: boolean) {
	for (const {el, height} of drag.levels) {
		el.style.transition = "";
		if (dismiss) {
			el.style.translate = `0 ${SHEET_OFFSCREEN}`;
		} else {
			el.style.height = height;
			el.style.translate = "";
		}
	}
	for (const scrim of drag.scrims) {
		scrim.style.transition = "";
		scrim.style.opacity = "";
	}
}

/** Upstream's bM: the viewport height below the positioner's top safe-area margin. */
function availableHeight(popup: HTMLElement): number {
	const view = popup.ownerDocument.defaultView;
	if (view === null) return popup.getBoundingClientRect().height;
	const positioner = popup.parentElement;
	if (positioner === null) return view.innerHeight;
	const margin = Number.parseFloat(view.getComputedStyle(positioner).scrollMarginTop);
	return margin > 0 ? Math.max(0, view.innerHeight - margin) : view.innerHeight;
}

function prefersReducedMotion(view: Window | null): boolean {
	return view?.matchMedia(REDUCED_MOTION_QUERY).matches === true;
}

/** Upstream's Hi: a level holding a text field, or whose rows overflow, can open the tall detent. */
function contentGrows(popup: HTMLElement): boolean {
	if (popup.querySelector(SHEET_TEXT_ENTRY) !== null) return true;
	return Array.from(popup.querySelectorAll("[data-cds-sheet-scroll]")).some(
		(scroll) => scroll.scrollHeight > scroll.clientHeight + 1,
	);
}

/**
 * Upstream's ct: pointer handlers for a sheet's handle and title bar. The finger drags every open
 * level of the tree; release dismisses past a quarter of the rest height or on a downward fling,
 * else settles on the default or tall detent.
 */
export function useSheetDrag() {
	const frame = useContext(SheetDragContext);
	const dragRef = useRef<Drag | null>(null);
	return useMemo(() => {
		if (frame === null) return {};
		const tree = `[data-presentation="sheet"][data-sheet-tree="${CSS.escape(frame.treeId)}"]`;
		const finish = (event: PointerEvent<HTMLElement>, commit: boolean) => {
			const drag = dragRef.current;
			if (drag === null || event.pointerId !== drag.pointerId) return;
			dragRef.current = null;
			if (event.currentTarget.hasPointerCapture(event.pointerId)) {
				event.currentTarget.releasePointerCapture(event.pointerId);
			}
			const {dismiss, detent} = release(drag, {
				detent: drag.detent,
				rawAtGrab: drag.raw,
				rawAtRelease: drag.raw - (drag.lastY - drag.startY),
				caughtSlide: drag.caughtSlide,
				velocity: drag.velocity,
				msSinceMove: event.timeStamp - drag.lastT,
				commit,
			});
			endDrag(drag, dismiss);
			if (dismiss) frame.dismiss();
			else if (detent !== drag.detent) frame.setDetent(detent);
		};
		return {
			onPointerDown: (event: PointerEvent<HTMLElement>) => {
				if (event.button !== 0 || dragRef.current !== null || frame.keyboard === true) return;
				if (event.target instanceof Element && event.target.closest(NO_DRAG_TARGET) !== null) return;
				if (event.currentTarget.closest("[data-cds-sheet-covered]") !== null) return;
				const popup = event.currentTarget.closest<HTMLElement>('[data-presentation="sheet"]');
				if (popup === null) return;
				const rect = popup.getBoundingClientRect();
				const height = rect.height;
				const floor = popup.parentElement?.getBoundingClientRect().bottom ?? rect.bottom;
				const caughtSlide = Math.max(0, rect.bottom - floor);
				event.currentTarget.setPointerCapture(event.pointerId);
				const doc = popup.ownerDocument;
				const levels = Array.from(doc.querySelectorAll<HTMLElement>(`${tree}:not([data-ending-style])`)).map(
					(el) => {
						const saved = el.style.height;
						el.style.transition = "none";
						el.style.height = `${height}px`;
						return {el, height: saved};
					},
				);
				const canGrow = contentGrows(popup) || frame.detent === "tall";
				const geometry = sheetGeometry(height, availableHeight(popup), TALL_FRACTION, canGrow);
				const banded = prefersReducedMotion(doc.defaultView) || !canGrow ? {...geometry, room: 0} : geometry;
				const scrims = Array.from(
					doc.querySelectorAll<HTMLElement>(
						`[data-presentation="sheet"][data-sheet-scrim="${CSS.escape(frame.treeId)}"]`,
					),
				);
				for (const scrim of scrims) scrim.style.transition = "none";
				const drag: Drag = {
					...banded,
					pointerId: event.pointerId,
					startY: event.clientY,
					lastY: event.clientY,
					lastT: event.timeStamp,
					velocity: 0,
					detent: frame.detent,
					raw: rawAt(banded, height, caughtSlide),
					caughtSlide,
					levels,
					scrims,
				};
				dragRef.current = drag;
				applyDrag(drag, 0);
			},
			onPointerMove: (event: PointerEvent<HTMLElement>) => {
				const drag = dragRef.current;
				if (drag === null || event.pointerId !== drag.pointerId) return;
				const elapsed = event.timeStamp - drag.lastT;
				if (elapsed > 0) drag.velocity = (event.clientY - drag.lastY) / elapsed;
				drag.lastY = event.clientY;
				drag.lastT = event.timeStamp;
				applyDrag(drag, event.clientY - drag.startY);
			},
			onPointerUp: (event: PointerEvent<HTMLElement>) => {
				finish(event, true);
			},
			onPointerCancel: (event: PointerEvent<HTMLElement>) => {
				finish(event, false);
			},
			onLostPointerCapture: (event: PointerEvent<HTMLElement>) => {
				finish(event, false);
			},
		};
	}, [frame]);
}
