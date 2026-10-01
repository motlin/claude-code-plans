import {
	type KeyboardEvent as ReactKeyboardEvent,
	type PointerEvent as ReactPointerEvent,
	useEffect,
	useRef,
} from "react";

/** Which edge of the resized panel the handle sits on: "end" grows rightward, "start" grows leftward. */
export type ResizeEdge = "start" | "end";

interface UseResizableWidthOptions {
	label: string;
	min: number;
	max: number;
	step: number;
	edge: ResizeEdge;
	value: number;
	onChange: (width: number) => void;
	/** A press that never moves past {@link CLICK_THRESHOLD_PX}, e.g. upstream's click-to-hide sidebar edge. */
	onClick?: () => void;
}

/** Pointer travel (px) below which a press on the handle is a click rather than a drag. */
const CLICK_THRESHOLD_PX = 3;

interface ActiveResize {
	pointerId: number;
	handle: HTMLElement;
	startingClientX: number;
	startingWidth: number;
	dragging: boolean;
}

/** Props for a `role=separator` resize handle: ARIA values, pointer drag, and Arrow/Home/End keys. */
export function useResizableWidth({label, min, max, step, edge, value, onChange, onClick}: UseResizableWidthOptions) {
	const activeResizeReference = useRef<ActiveResize>(null);
	const clamp = (width: number) => Math.min(max, Math.max(min, width));
	const direction = edge === "end" ? 1 : -1;

	useEffect(() => {
		return () => {
			const activeResize = activeResizeReference.current;
			if (activeResize?.handle.hasPointerCapture(activeResize.pointerId)) {
				activeResize.handle.releasePointerCapture(activeResize.pointerId);
			}
			activeResizeReference.current = null;
		};
	}, []);

	function finishResize(event: ReactPointerEvent<HTMLElement>): boolean {
		const activeResize = activeResizeReference.current;
		if (activeResize?.pointerId !== event.pointerId) return false;

		activeResizeReference.current = null;
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		return !activeResize.dragging;
	}

	return {
		role: "separator",
		"aria-label": label,
		"aria-orientation": "vertical",
		"aria-valuemin": min,
		"aria-valuemax": max,
		"aria-valuenow": value,
		"aria-valuetext": `${value} pixels`,
		tabIndex: 0,
		onKeyDown(event: ReactKeyboardEvent<HTMLElement>): void {
			let next: number;
			if (event.key === "ArrowRight") next = value + step * direction;
			else if (event.key === "ArrowLeft") next = value - step * direction;
			else if (event.key === "Home") next = min;
			else if (event.key === "End") next = max;
			else return;
			event.preventDefault();
			onChange(clamp(next));
		},
		onPointerDown(event: ReactPointerEvent<HTMLElement>): void {
			if (activeResizeReference.current) return;

			event.preventDefault();
			event.currentTarget.setPointerCapture(event.pointerId);
			activeResizeReference.current = {
				pointerId: event.pointerId,
				handle: event.currentTarget,
				startingClientX: event.clientX,
				startingWidth: value,
				dragging: false,
			};
		},
		onPointerMove(event: ReactPointerEvent<HTMLElement>): void {
			const activeResize = activeResizeReference.current;
			if (activeResize?.pointerId !== event.pointerId) return;

			const delta = event.clientX - activeResize.startingClientX;
			if (!activeResize.dragging && Math.abs(delta) < CLICK_THRESHOLD_PX) return;

			activeResize.dragging = true;
			const distance = delta * direction;
			onChange(clamp(activeResize.startingWidth + distance));
		},
		onPointerUp(event: ReactPointerEvent<HTMLElement>): void {
			if (finishResize(event)) onClick?.();
		},
		onPointerCancel(event: ReactPointerEvent<HTMLElement>): void {
			finishResize(event);
		},
		onLostPointerCapture(event: ReactPointerEvent<HTMLElement>): void {
			if (activeResizeReference.current?.pointerId === event.pointerId) {
				activeResizeReference.current = null;
			}
		},
	} as const;
}
