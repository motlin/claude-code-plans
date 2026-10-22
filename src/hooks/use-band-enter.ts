import {type RefCallback, useCallback} from "react";

/**
 * Ref for a composer band slot. Like upstream's band-enter hook, it sets `data-band-enter`
 * two animation frames after mount, so a `.band-enter` band already there at first paint
 * stays put and only bands that mount into the slot later play the enter transition.
 */
export function useBandEnter<T extends HTMLElement>(): RefCallback<T> {
	return useCallback((element: T | null) => {
		const view = element?.ownerDocument.defaultView;
		if (!element || !view) return undefined;
		let second = 0;
		const first = view.requestAnimationFrame(() => {
			second = view.requestAnimationFrame(() => {
				element.dataset["bandEnter"] = "";
			});
		});
		return () => {
			view.cancelAnimationFrame(first);
			view.cancelAnimationFrame(second);
			delete element.dataset["bandEnter"];
		};
	}, []);
}
