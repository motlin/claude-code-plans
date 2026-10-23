import type {Modifier} from "@dnd-kit/core";

/** Upstream's rail drag modifier: sections only move up and down. */
export const lockRailDragToVerticalAxis: Modifier = ({transform}) => ({...transform, x: 0});

/** Upstream drops focus when a pointer picks up a section; a keyboard pick-up keeps it on the grip. */
export function blurOnPointerDragStart(activatorEvent: Event | null): void {
	if (activatorEvent instanceof KeyboardEvent) return;
	const focused = document.activeElement;
	if (focused instanceof HTMLElement) focused.blur();
}

/** Upstream's drop animation: slide the moved section from where it was let go into its new slot. */
export function animateRailDrop(element: HTMLElement, dropTop: number): void {
	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
	const delta = dropTop - element.getBoundingClientRect().top;
	if (Math.abs(delta) < 1) return;
	element.animate([{transform: `translate3d(0,${delta}px,0)`}, {transform: "translate3d(0,0,0)"}], {
		duration: 200,
		easing: "ease",
	});
}
