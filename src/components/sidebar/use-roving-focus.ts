import {type KeyboardEvent, useCallback, useLayoutEffect, useRef} from "react";

/** Marks an element as one stop of the sidebar session list's roving focus. */
export const ROVING_ITEM_PROPS = {"data-roving-item": ""} as const;

const ITEM_SELECTOR = "[data-roving-item]";

/** The list's items in DOM order, skipping inert subtrees such as the empty Pinned stub. */
function rovingItems(container: HTMLElement): HTMLElement[] {
	return [...container.querySelectorAll<HTMLElement>(ITEM_SELECTOR)].filter(
		(item) => item.closest("[inert]") === null,
	);
}

/** The key's target index among `count` items, or null when the key does not move focus. */
function rovingTargetIndex(key: string, current: number, count: number): number | null {
	if (count === 0) return null;
	switch (key) {
		case "ArrowDown":
			return Math.min(current + 1, count - 1);
		case "ArrowUp":
			return Math.max(current - 1, 0);
		case "Home":
			return 0;
		case "End":
			return count - 1;
		default:
			return null;
	}
}

function isMenuKey(event: KeyboardEvent): boolean {
	return event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey);
}

/**
 * claude.ai/code's recents list as a roving-tabindex composite: one tab stop (the last
 * focused item, else the selected row, else the first), arrows and Home/End to move,
 * and the Menu key or Shift+F10 to open the focused row's menu.
 */
export function useRovingFocus() {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const lastFocused = useRef<HTMLElement | null>(null);
	const observer = useRef<MutationObserver | null>(null);

	const sync = useCallback(() => {
		const container = containerRef.current;
		if (container === null) return;
		const items = rovingItems(container);
		const remembered = lastFocused.current;
		const stop =
			(remembered !== null && items.includes(remembered) ? remembered : undefined) ??
			items.find((item) => item.dataset["selected"] === "focused") ??
			items[0];
		for (const item of items) {
			const tabIndex = item === stop ? 0 : -1;
			// Rewriting an unchanged tabindex is still a DOM mutation, so only touch the ones that move.
			if (item.getAttribute("tabindex") !== String(tabIndex)) item.tabIndex = tabIndex;
		}
	}, []);

	useLayoutEffect(sync);

	// Rows mount and unmount from child re-renders too (a family or group toggling), so
	// the tab stop is re-chosen whenever the list's DOM changes.
	const ref = useCallback(
		(element: HTMLDivElement | null) => {
			observer.current?.disconnect();
			observer.current = null;
			containerRef.current = element;
			if (element === null || typeof MutationObserver === "undefined") return;
			observer.current = new MutationObserver(sync);
			observer.current.observe(element, {
				childList: true,
				subtree: true,
				attributes: true,
				attributeFilter: ["data-selected", "inert"],
			});
			sync();
		},
		[sync],
	);

	const onFocus = (event: {target: EventTarget}) => {
		if (!(event.target instanceof HTMLElement) || !event.target.matches(ITEM_SELECTOR)) return;
		lastFocused.current = event.target;
		sync();
	};

	const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
		const container = containerRef.current;
		if (container === null || !(event.target instanceof HTMLElement)) return;
		const item = event.target.closest<HTMLElement>(ITEM_SELECTOR);
		if (item === null || event.target !== item) return;
		if (isMenuKey(event)) {
			const kebab = item.closest("[data-session-actions]")?.querySelector<HTMLElement>("[data-row-action]");
			if (kebab === undefined || kebab === null) return;
			event.preventDefault();
			kebab.click();
			return;
		}
		if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
		const items = rovingItems(container);
		const index = rovingTargetIndex(event.key, items.indexOf(item), items.length);
		if (index === null) return;
		event.preventDefault();
		items[index]?.focus();
	};

	return {ref, onFocus, onKeyDown};
}
