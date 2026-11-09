import {useLayoutEffect, useState} from "react";

/**
 * Upstream's `useIsOverflowing` (shared-40): whether `element`'s content runs past its box on the x axis
 * (`scrollWidth > clientWidth + slackPx`). It measures on mount, whenever `text` changes, on every resize, and once
 * more after `document.fonts.ready`, so a web font that loads late still picks the right text.
 */
export function useIsOverflowing(element: HTMLElement | null, text: string, slackPx = 0): boolean {
	const [overflowing, setOverflowing] = useState(false);
	useLayoutEffect(() => {
		if (element === null) {
			setOverflowing(false);
			return undefined;
		}
		let live = true;
		const measure = () => {
			if (live) setOverflowing(element.scrollWidth > element.clientWidth + slackPx);
		};
		measure();
		const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
		observer?.observe(element);
		const fonts = element.ownerDocument.fonts as FontFaceSet | undefined;
		fonts?.ready.then(measure).catch(() => {});
		return () => {
			live = false;
			observer?.disconnect();
		};
	}, [element, text, slackPx]);
	return overflowing;
}
