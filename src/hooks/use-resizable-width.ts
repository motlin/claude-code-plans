import {type KeyboardEvent as ReactKeyboardEvent, useRef} from "react";

/** Which edge of the resized panel the handle sits on: "end" grows rightward, "start" grows leftward. */
export type ResizeEdge = "start" | "end";

interface UseResizableWidthOptions {
	label: string;
	min: number;
	max: number;
	edge: ResizeEdge;
	value: number;
	onChange: (width: number) => void;
	/** A press that never moves past 3px, or Enter/Space, e.g. upstream's click-to-hide sidebar edge. */
	onClick?: () => void;
	/** Double-click and Enter/Space reset to this width, like upstream's Customize file list. */
	defaultWidth?: number;
}

/**
 * Width-column props for a {@link import("../components/ui/resize-handle").ResizeHandle}: ARIA
 * values, drag and Arrow steps applied to the width, Home/End, and the optional click and reset.
 */
export function useResizableWidth({
	label,
	min,
	max,
	edge,
	value,
	onChange,
	onClick,
	defaultWidth,
}: UseResizableWidthOptions) {
	const startingWidthReference = useRef(value);
	const clamp = (width: number) => Math.min(max, Math.max(min, width));
	const direction = edge === "end" ? 1 : -1;

	return {
		"aria-label": label,
		"aria-valuemin": min,
		"aria-valuemax": max,
		"aria-valuenow": value,
		"aria-valuetext": `${value} pixels`,
		onResizeStart(): void {
			startingWidthReference.current = value;
		},
		onResize(delta: number): void {
			onChange(clamp(startingWidthReference.current + delta * direction));
		},
		onResizeEnd(moved: boolean): void {
			if (moved) return;
			// Like upstream's hosts, a press that never passed the threshold keeps the starting width.
			if (value !== startingWidthReference.current) onChange(startingWidthReference.current);
			onClick?.();
		},
		onKeyDown(event: ReactKeyboardEvent<HTMLElement>): void {
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			if (defaultWidth !== undefined && (event.key === "Enter" || event.key === " ") && !event.shiftKey) {
				if (!event.repeat) onChange(defaultWidth);
				return;
			}
			if (event.key !== "Home" && event.key !== "End") return;
			event.preventDefault();
			onChange(event.key === "Home" ? min : max);
		},
		...(defaultWidth === undefined
			? {}
			: {
					onDoubleClick(): void {
						onChange(defaultWidth);
					},
				}),
	};
}
