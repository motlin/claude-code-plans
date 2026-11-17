import
{
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type PointerEvent as ReactPointerEvent,
	type RefObject,
} from "react";

import type {LayoutNode, PaneLayoutState, StackNode, TileId} from "../../lib/pane-layout";
import
{
	applyTileDrop,
	dropRect,
	resolveTileDrop,
	stackRectKey,
	type DropRect,
	type TileDropTarget,
} from "../../lib/tile-drop";

/** Upstream line mode `dragLift`: the dragged tile's translateZ. */
export const TILE_DRAG_LIFT_PX = 24;
/** Approximates upstream's settle spring `{stiffness: 500, damping: 46}` (local has no motion library). */
const SETTLE_MS = 250;
const SETTLE_TRANSITION = `transform ${SETTLE_MS}ms cubic-bezier(0.2, 0, 0, 1)`;
const DRAG_X = "--tile-drag-x";
const DRAG_Y = "--tile-drag-y";

type LayoutUpdate = (state: PaneLayoutState) => PaneLayoutState;

interface Point
{
	x: number;
	y: number;
}

interface ActiveDrag
{
	tileId: TileId;
	pointerId: number;
	/** The pointer at pointerdown, in client space. */
	start: Point;
	/** The dragged slot's untransformed client origin at pointerdown. */
	origin: Point;
	/** The translation applied to the slot so it follows the pointer. */
	offset: Point;
	startRoot: StackNode;
	rearranged: boolean;
	pending: TileDropTarget | null;
	detach: () => void;
}

export interface TileDrag
{
	/** Upstream `interaction.mode === "dragging-tile"`: the tile being dragged, or null. */
	dragging: TileId | null;
	/** Upstream `dragVisualTileId`: the lifted tile, held until it settles after the drag. */
	lifted: TileId | null;
	/** Upstream `dropFeedback.target` for a pointer drag. */
	target: TileDropTarget | null;
	start: (tileId: TileId, event: ReactPointerEvent<HTMLElement>) => void;
}

function slotOf(root: HTMLElement, tileId: TileId): HTMLElement | null
{
	return root.querySelector<HTMLElement>(`[data-tile-slot="${tileId}"]`);
}

/** Each tile's and stack's rect in tile-container space, the dragged tile's without its drag translation. */
function measureRects(
	rootElement: HTMLElement,
	stackElements: ReadonlyMap<string, HTMLElement>,
	root: StackNode,
	drag: ActiveDrag,
): Map<string, DropRect>
{
	const container = rootElement.getBoundingClientRect();
	const rects = new Map<string, DropRect>();
	const measure = (key: string, element: HTMLElement | null | undefined, shift: Point) =>
	{
		if (element === null || element === undefined) return;
		const box = element.getBoundingClientRect();
		rects.set(
			key,
			dropRect(box.left - container.left - shift.x, box.top - container.top - shift.y, box.width, box.height),
		);
	};
	const still =
	{
		x: 0,
		y: 0,
	};
	const walk = (node: LayoutNode, path: number[]) =>
	{
		if (node.kind === "tile")
		{
			measure(node.tileId, slotOf(rootElement, node.tileId), node.tileId === drag.tileId ? drag.offset : still);
			return;
		}
		const key = stackRectKey(path);
		measure(key, path.length === 0 ? rootElement : stackElements.get(key), still);
		node.children.forEach((child, index) =>
		{
			walk(child, [...path, index]);
		});
	};
	walk(root, []);
	return rects;
}

function prefersReducedMotion(): boolean
{
	return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Upstream's tiles controller `Me` for a Move-grip drag: the drag starts at pointerdown, the tile follows the pointer
 * lifted above the others, drop feedback resolves through `resolveTileDrop`, a drag inside the tile's own stack
 * reorders it live, and release commits. Escape and pointercancel restore the starting layout; afterwards the tile
 * settles back into its slot.
 */
export function useTileDrag(
	rootRef: RefObject<HTMLDivElement | null>,
	stackElements: ReadonlyMap<string, HTMLElement>,
	layout: PaneLayoutState,
	update: (fn: LayoutUpdate) => void,
): TileDrag
{
	const [dragging, setDragging] = useState<TileId | null>(null);
	const [lifted, setLifted] = useState<TileId | null>(null);
	const [target, setTarget] = useState<TileDropTarget | null>(null);
	const latest = useRef(
		{
			layout,
			update,
		},
	);
	useLayoutEffect(() =>
	{
		latest.current =
		{
			layout,
			update,
		};
	});
	const dragRef = useRef<ActiveDrag | null>(null);
	const settleRef = useRef<(() => void) | null>(null);

	useEffect(
		() => () =>
		{
			dragRef.current?.detach();
			settleRef.current?.();
		},
		[],
	);

	const settle = useCallback(
		(tileId: TileId, offset: Point, landed: boolean) =>
		{
			const root = rootRef.current;
			const slot = root === null ? null : slotOf(root, tileId);
			let timer: ReturnType<typeof setTimeout> | undefined;
			const done = () =>
			{
				clearTimeout(timer);
				slot?.removeEventListener("transitionend", onEnd);
				slot?.style.removeProperty(DRAG_X);
				slot?.style.removeProperty(DRAG_Y);
				slot?.style.removeProperty("transition");
				settleRef.current = null;
				setLifted(null);
			};
			function onEnd(event: TransitionEvent)
			{
				if (event.target === slot) done();
			}
			// A committed drop lands in its new slot at once; upstream's reduced motion settles with duration 0.
			if (slot === null || landed || (offset.x === 0 && offset.y === 0) || prefersReducedMotion())
			{
				done();
				return;
			}
			slot.style.transition = SETTLE_TRANSITION;
			slot.style.setProperty(DRAG_X, "0px");
			slot.style.setProperty(DRAG_Y, "0px");
			slot.addEventListener("transitionend", onEnd);
			timer = setTimeout(done, SETTLE_MS + 50);
			settleRef.current = done;
		},
		[rootRef],
	);

	const start = useCallback(
		(tileId: TileId, event: ReactPointerEvent<HTMLElement>) =>
		{
			const root = rootRef.current;
			if (event.button !== 0 || dragRef.current !== null || root === null) return;
			settleRef.current?.();
			const slot = slotOf(root, tileId);
			if (slot === null) return;
			const box = slot.getBoundingClientRect();
			event.currentTarget.setPointerCapture(event.pointerId);
			const view = root.ownerDocument.defaultView ?? window;

			const finish = (commit: boolean) =>
			{
				const drag = dragRef.current;
				if (drag === null) return;
				drag.detach();
				dragRef.current = null;
				setDragging(null);
				setTarget(null);
				const {pending} = drag;
				const landed = commit && pending !== null;
				if (landed) latest.current.update((state) => applyTileDrop(state, drag.tileId, pending));
				else if (!commit && drag.rearranged)
				{
					latest.current.update((state) => (
					{
						...state,
						root: drag.startRoot,
					}));
				}
				settle(drag.tileId, drag.offset, landed);
			};
			const onMove = (moveEvent: PointerEvent) =>
			{
				const drag = dragRef.current;
				if (drag === null || moveEvent.pointerId !== drag.pointerId) return;
				// Upstream: a mouse move with the primary button up is a release the pointerup never reported.
				if (moveEvent.pointerType === "mouse" && (moveEvent.buttons & 1) === 0)
				{
					finish(true);
					return;
				}
				const current = rootRef.current;
				const element = current === null ? null : slotOf(current, drag.tileId);
				if (current === null || element === null) return;
				const {root: layoutRoot} = latest.current.layout;
				const rects = measureRects(current, stackElements, layoutRoot, drag);
				const container = current.getBoundingClientRect();
				const own = rects.get(drag.tileId);
				// Follow the pointer 1:1 from wherever the slot sits now, so a live reorder does not jump the tile.
				const slotShift =
					own === undefined
						?
							{
								x: 0,
								y: 0,
							}
						:
							{
								x: own.left + container.left - drag.origin.x,
								y: own.top + container.top - drag.origin.y,
							};
				drag.offset =
				{
					x: moveEvent.clientX - drag.start.x - slotShift.x,
					y: moveEvent.clientY - drag.start.y - slotShift.y,
				};
				element.style.setProperty(DRAG_X, `${drag.offset.x}px`);
				element.style.setProperty(DRAG_Y, `${drag.offset.y}px`);
				const resolution = resolveTileDrop(
					layoutRoot,
					drag.tileId,
					rects,
					{
						x: moveEvent.clientX - container.left,
						y: moveEvent.clientY - container.top,
					},
					{
						x: drag.start.x - container.left,
						y: drag.start.y - container.top,
					},
				);
				const pending = resolution.kind === "drop" ? resolution.target : null;
				if (JSON.stringify(pending) !== JSON.stringify(drag.pending)) setTarget(pending);
				drag.pending = pending;
				if (resolution.kind === "rearrange")
				{
					drag.rearranged = true;
					latest.current.update((state) => (
					{
						...state,
						root: resolution.root,
					}));
				}
			};
			const onUp = (upEvent: PointerEvent) =>
			{
				if (upEvent.pointerId === dragRef.current?.pointerId) finish(true);
			};
			const onCancel = (cancelEvent: PointerEvent) =>
			{
				if (cancelEvent.pointerId === dragRef.current?.pointerId) finish(false);
			};
			const onKeyDown = (keyEvent: KeyboardEvent) =>
			{
				if (keyEvent.key !== "Escape" || keyEvent.defaultPrevented || keyEvent.isComposing) return;
				keyEvent.preventDefault();
				keyEvent.stopImmediatePropagation();
				finish(false);
			};
			view.addEventListener("pointermove", onMove);
			view.addEventListener("pointerup", onUp);
			view.addEventListener("pointercancel", onCancel);
			view.addEventListener("keydown", onKeyDown, true);
			dragRef.current =
			{
				tileId,
				pointerId: event.pointerId,
				start:
				{
					x: event.clientX,
					y: event.clientY,
				},
				origin:
				{
					x: box.left,
					y: box.top,
				},
				offset:
				{
					x: 0,
					y: 0,
				},
				startRoot: latest.current.layout.root,
				rearranged: false,
				pending: null,
				detach: () =>
				{
					view.removeEventListener("pointermove", onMove);
					view.removeEventListener("pointerup", onUp);
					view.removeEventListener("pointercancel", onCancel);
					view.removeEventListener("keydown", onKeyDown, true);
				},
			};
			setDragging(tileId);
			setLifted(tileId);
			setTarget(null);
		},
		[rootRef, stackElements, settle],
	);

	return {
		dragging,
		lifted,
		target,
		start,
	};
}
