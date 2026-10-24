import {type FocusEvent, type KeyboardEvent, useCallback, useLayoutEffect, useRef} from "react";

/**
 * A toolbar's focusable items: enabled buttons, plus a cds disabled-reason wrapper while it holds a reason (it is
 * described by it then) and so stands in for its disabled control.
 */
const ITEM_SELECTOR = "button:not(:disabled), [data-cds-disabled-reason-wrapper][aria-describedby]";

function toolbarItems(toolbar: HTMLElement): HTMLElement[] {
	return [...toolbar.querySelectorAll<HTMLElement>(ITEM_SELECTOR)];
}

/**
 * Upstream's cds toolbar roving keys (`RC` in claude.ai/code's shared-frame chunk): the
 * toolbar is one tab stop, held by the first item until another is focused and then by
 * the last focused one. ArrowRight/ArrowLeft move and wrap (mirrored in RTL), Home and
 * End jump to the ends, modifier combinations are ignored, and Space on the toolbar
 * itself is swallowed. Spread the returned props onto the `role="toolbar"` element.
 */
export function useRovingToolbar<T extends HTMLElement = HTMLDivElement>() {
	const toolbarRef = useRef<T | null>(null);
	const lastFocused = useRef<HTMLElement | null>(null);

	const sync = useCallback(() => {
		const toolbar = toolbarRef.current;
		if (toolbar === null) return;
		const items = toolbarItems(toolbar);
		const remembered = lastFocused.current;
		const stop = remembered !== null && items.includes(remembered) ? remembered : items[0];
		for (const item of items) {
			const tabIndex = item === stop ? 0 : -1;
			if (item.getAttribute("tabindex") !== String(tabIndex)) item.tabIndex = tabIndex;
		}
	}, []);

	useLayoutEffect(sync);

	// Items can mount, enable or gain a reason without the toolbar itself re-rendering (a context change in one
	// child), so re-elect the tab stop on those mutations too. sync only writes a changed tabindex, so it settles.
	useLayoutEffect(() => {
		const toolbar = toolbarRef.current;
		if (toolbar === null || typeof MutationObserver === "undefined") return undefined;
		const observer = new MutationObserver(sync);
		observer.observe(toolbar, {
			subtree: true,
			childList: true,
			attributes: true,
			attributeFilter: ["disabled", "aria-describedby", "tabindex"],
		});
		return () => {
			observer.disconnect();
		};
	}, [sync]);

	const ref = useCallback(
		(element: T | null) => {
			toolbarRef.current = element;
			sync();
		},
		[sync],
	);

	const onFocus = useCallback(
		(event: FocusEvent<T>) => {
			const toolbar = toolbarRef.current;
			if (toolbar === null || !(event.target instanceof HTMLElement)) return;
			if (!toolbarItems(toolbar).includes(event.target)) return;
			lastFocused.current = event.target;
			sync();
		},
		[sync],
	);

	const onKeyDown = useCallback((event: KeyboardEvent<T>) => {
		const toolbar = toolbarRef.current;
		if (toolbar === null || event.altKey || event.ctrlKey || event.metaKey) return;
		if (!(event.target instanceof Node) || !toolbar.contains(event.target)) return;
		if (event.key === " ") {
			if (event.target === toolbar) event.preventDefault();
			return;
		}
		const items = toolbarItems(toolbar);
		if (items.length === 0) return;
		const active = toolbar.ownerDocument.activeElement;
		const current = items.findIndex((item) => item === active);
		const step = (offset: number): HTMLElement | undefined => {
			if (current !== -1) return items[(current + offset + items.length) % items.length];
			const remembered = lastFocused.current;
			return remembered !== null && items.includes(remembered) ? remembered : items[0];
		};
		const forward = toolbar.ownerDocument.defaultView?.getComputedStyle(toolbar).direction === "rtl" ? -1 : 1;
		let target: HTMLElement | undefined;
		switch (event.key) {
			case "ArrowRight":
				target = step(forward);
				break;
			case "ArrowLeft":
				target = step(-forward);
				break;
			case "Home":
				target = items[0];
				break;
			case "End":
				target = items.at(-1);
				break;
			default:
				return;
		}
		if (target === undefined) return;
		event.preventDefault();
		target.focus();
	}, []);

	return {ref, onFocus, onKeyDown};
}
