import type {BaseUIEvent} from "@base-ui/react/types";
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

/** Upstream's sidebar-body roving set: rows' main items plus group toggles. */
const BODY_ITEM_SELECTOR = "[data-roving-item], [data-group-toggle]";
const ROW_SELECTOR = "[data-row], [data-sidebar-group-label]";
const SECTION_SELECTOR = "[data-tab-section]";
const NATURAL_SECTION_SELECTOR = '[data-tab-section="natural"]';

/** The body's rendered, enabled, non-inert roving items in DOM order (upstream `RT` + `Wb`). */
function bodyItems(container: HTMLElement): HTMLElement[] {
	return [...container.querySelectorAll<HTMLElement>(BODY_ITEM_SELECTOR)].filter(
		(item) =>
			item.offsetParent !== null &&
			!item.matches(":disabled") &&
			item.closest("[inert]") === null &&
			item.closest(NATURAL_SECTION_SELECTOR) === null,
	);
}

/**
 * The roving item `element` belongs to (upstream `k9`): itself or its closest item, else the item
 * of its row or group header when that sits in the same tab section, so a kebab or header button maps
 * to its row.
 */
function owningItem(element: Element): HTMLElement | null {
	const own = element.closest<HTMLElement>(BODY_ITEM_SELECTOR);
	if (own !== null) return own;
	const rowItem = element.closest(ROW_SELECTOR)?.querySelector<HTMLElement>(BODY_ITEM_SELECTOR) ?? null;
	return rowItem?.closest(SECTION_SELECTOR) === element.closest(SECTION_SELECTOR) ? rowItem : null;
}

/** The key's target index among `count` items with wrap-around, or null when the key does not rove. */
function bodyTargetIndex(key: string, current: number, count: number): number | null {
	switch (key) {
		case "Home":
			return 0;
		case "End":
			return count - 1;
		case "ArrowDown":
			return current === -1 ? 0 : (current + 1) % count;
		case "ArrowUp":
			return current === -1 ? count - 1 : (current - 1 + count) % count;
		default:
			return null;
	}
}

/**
 * Upstream's `oa` trigger handler: a sidebar menu trigger (More, a row kebab) skips Base UI's
 * open-on-arrow so ArrowUp/Down keep roving the sidebar body.
 */
export function keepArrowsRoving(event: BaseUIEvent<KeyboardEvent<HTMLElement>>): void {
	if (event.metaKey || event.ctrlKey || event.altKey) return;
	if (event.key === "ArrowDown" || event.key === "ArrowUp") event.preventBaseUIHandler();
}

/**
 * claude.ai/code's sidebar body keyboard container (upstream `L$`): ArrowUp/Down (wrapping) and
 * Home/End rove across the Search field, New, the nav rows and every session-list row and group
 * toggle. Shift is ignored, as upstream does; Meta, Ctrl and Alt opt out.
 */
export function useSidebarBodyRoving() {
	const ref = useRef<HTMLDivElement | null>(null);

	const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
		const container = ref.current;
		const active = document.activeElement;
		if (container === null || active === null || !container.contains(active)) return;
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		const item = owningItem(active);
		if (item === null) return;
		const items = bodyItems(container);
		if (items.length === 0) return;
		const index = bodyTargetIndex(event.key, items.indexOf(item), items.length);
		if (index === null) return;
		const target = items[index];
		if (target === undefined) return;
		event.preventDefault();
		target.focus();
		target.scrollIntoView({block: "nearest"});
	};

	return {ref, onKeyDown};
}

function isMenuKey(event: KeyboardEvent): boolean {
	return event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey);
}

/**
 * claude.ai/code's recents list tab stop: one tab stop (the last focused item, else the selected
 * row, else the first), and the Menu key or Shift+F10 to open the focused row's menu. Arrow keys
 * belong to the whole sidebar body (`useSidebarBodyRoving`).
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
		if (!isMenuKey(event) || !(event.target instanceof HTMLElement)) return;
		const item = event.target.closest<HTMLElement>(ITEM_SELECTOR);
		if (item === null || event.target !== item) return;
		const kebab = item.closest("[data-session-actions]")?.querySelector<HTMLElement>("[data-row-action]");
		if (kebab === undefined || kebab === null) return;
		event.preventDefault();
		kebab.click();
	};

	return {ref, onFocus, onKeyDown};
}
