import type {BaseUIEvent} from "@base-ui/react/types";
import {type KeyboardEvent, useEffect, useRef} from "react";

/** Marks an element as one stop of the sidebar session list's roving focus. */
export const ROVING_ITEM_PROPS = {"data-roving-item": ""} as const;

const ITEM_SELECTOR = "[data-roving-item]";

/** Marks the session list while rows are selected; upstream's `sectionTabStops:!editing` then stops re-choosing tab stops. */
const SELECTING_ATTRIBUTE = "data-sidebar-selecting";

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

/** Sets `element`'s tabindex, writing the attribute only when it changes. */
function setTabIndex(element: HTMLElement, tabIndex: number): void {
	if (element.getAttribute("tabindex") !== String(tabIndex)) element.tabIndex = tabIndex;
}

/**
 * The items' runs of consecutive items sharing a `[data-tab-section]` ancestor (items with none
 * form runs too), each run being one Tab stop.
 */
function tabGroups(items: readonly HTMLElement[]): HTMLElement[][] {
	const groups: HTMLElement[][] = [];
	let section: Element | null | undefined;
	for (const item of items) {
		const itemSection = item.closest(SECTION_SELECTOR);
		const last = groups.at(-1);
		if (last !== undefined && itemSection === section) last.push(item);
		else groups.push([item]);
		section = itemSection;
	}
	return groups;
}

/** The focusable controls of `element`'s row or group header, which ArrowLeft/Right move along (upstream `C1`). */
function rowControls(element: Element): HTMLElement[] {
	const row = element.closest(ROW_SELECTOR);
	if (row === null) return [];
	if (row.matches("[data-sidebar-group-label]")) {
		const section = element.closest(SECTION_SELECTOR);
		return [...row.querySelectorAll<HTMLElement>("button:enabled")].filter(
			(button) => button.offsetParent !== null && button.closest(SECTION_SELECTOR) === section,
		);
	}
	return [...row.querySelectorAll<HTMLElement>("[data-roving-item], [data-row-action]")];
}

/**
 * Upstream's `LW`: one Tab stop per tab section, the focused item, else the one last focused in
 * that section, else its first. Every other item and row control leaves the Tab order.
 */
function assignTabStops(container: HTMLElement, remembered: WeakSet<HTMLElement>): void {
	const items = bodyItems(container);
	const active = document.activeElement;
	const focusedItem = active !== null && container.contains(active) ? owningItem(active) : null;
	for (const group of tabGroups(items)) {
		const stop =
			group.find((item) => item === focusedItem) ?? group.find((item) => remembered.has(item)) ?? group[0];
		for (const item of group) {
			if (item === stop) remembered.add(item);
			else remembered.delete(item);
			setTabIndex(item, item === stop ? 0 : -1);
		}
	}
	for (const item of items) {
		for (const control of rowControls(item)) {
			if (control !== item) setTabIndex(control, -1);
		}
	}
}

/** ArrowRight/Left: focus the next or previous control in the focused element's row, clamping at the ends. */
function moveWithinRow(active: Element, step: 1 | -1, event: KeyboardEvent<HTMLElement>): void {
	const controls = rowControls(active);
	if (controls.length < 2) return;
	const index = controls.findIndex((control) => control === active);
	const target = controls[Math.min(Math.max(index + step, 0), controls.length - 1)];
	if (target === undefined || target === active) return;
	event.preventDefault();
	target.focus();
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
 * toggle; ArrowRight/Left move along a row's or group header's controls (kebab, Group and sort,
 * New session). Shift is ignored, as upstream does; Meta, Ctrl and Alt opt out. Each tab section is one
 * Tab stop, re-chosen on Tab and whenever focus moves inside the body, except while rows are selected.
 */
export function useSidebarBodyRoving() {
	const ref = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const remembered = new WeakSet<HTMLElement>();
		const sync = () => {
			const container = ref.current;
			if (container === null) return;
			if (container.querySelector(`[${SELECTING_ATTRIBUTE}]`) !== null) return;
			assignTabStops(container, remembered);
		};
		const onKeyDown = (event: globalThis.KeyboardEvent) => {
			if (event.key === "Tab") sync();
		};
		const onFocusIn = () => {
			const active = document.activeElement;
			if (active !== null && ref.current?.contains(active) === true) sync();
		};
		document.addEventListener("keydown", onKeyDown, true);
		document.addEventListener("focusin", onFocusIn);
		return () => {
			document.removeEventListener("keydown", onKeyDown, true);
			document.removeEventListener("focusin", onFocusIn);
		};
	}, []);

	const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
		const container = ref.current;
		const active = document.activeElement;
		if (container === null || active === null || !container.contains(active)) return;
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
			moveWithinRow(active, event.key === "ArrowRight" ? 1 : -1, event);
			return;
		}
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
 * The session list's Menu key and Shift+F10, which open the focused row's menu. Arrow keys and
 * Tab stops belong to the whole sidebar body (`useSidebarBodyRoving`).
 */
export function useRowMenuKey() {
	const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
		if (!isMenuKey(event) || !(event.target instanceof HTMLElement)) return;
		const item = event.target.closest<HTMLElement>(ITEM_SELECTOR);
		if (item === null || event.target !== item) return;
		const kebab = item.closest("[data-session-actions]")?.querySelector<HTMLElement>("[data-row-action]");
		if (kebab === undefined || kebab === null) return;
		event.preventDefault();
		kebab.click();
	};

	return {onKeyDown};
}
