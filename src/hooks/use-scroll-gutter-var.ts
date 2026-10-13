import {useLayoutEffect, type RefObject} from "react";

/**
 * Publish the scroller's per-edge scrollbar gutter (`scrollbar-gutter: stable
 * both-edges` reserves one on each side) as `--scroll-gutter`, so content inside
 * can size itself from the scroller's full width.
 */
export function useScrollGutterVar(ref: RefObject<HTMLElement | null>): void {
	useLayoutEffect(() => {
		const element = ref.current;
		if (element === null) return undefined;
		// The CSS falls back to 0px, so a scroller without gutters is never written to.
		let current = "0px";
		const measure = () => {
			const gutter = `${(element.offsetWidth - element.clientWidth) / 2}px`;
			if (gutter === current) return;
			current = gutter;
			element.style.setProperty("--scroll-gutter", gutter);
		};
		measure();
		if (typeof ResizeObserver === "undefined") return undefined;
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => {
			observer.disconnect();
		};
	}, [ref]);
}
