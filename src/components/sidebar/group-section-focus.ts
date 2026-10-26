import {type RefObject, useEffect, useLayoutEffect, useRef} from "react";

import type {SessionListPrefs} from "../../lib/session-groups";
import {expandSidebarGroup} from "../../lib/sidebar-store";

const GROUP_TOGGLE = "[data-group-toggle]";

/** The row key that last took focus, kept after the row unmounts (no focusin fires then). */
let focusedRowKey: string | null = null;
let trackingFocus = false;

function trackRowFocus(): void {
	if (trackingFocus || typeof document === "undefined") return;
	trackingFocus = true;
	document.addEventListener("focusin", (event) => {
		const target = event.target instanceof Element ? event.target : null;
		focusedRowKey = target?.closest("[data-row-key]")?.getAttribute("data-row-key") ?? null;
	});
}

/** Focus has fallen out of the document (body or a detached node). */
function focusLost(doc: Document): boolean {
	const active = doc.activeElement;
	return active === null || active === doc.body || !active.isConnected;
}

/** Upstream `bH`: the row has focus, or had it until it unmounted and focus fell to the body. */
function rowHasFocus(rowKey: string): boolean {
	if (focusedRowKey !== rowKey) return false;
	const active = document.activeElement;
	return focusLost(document) || active?.closest("[data-row-key]")?.getAttribute("data-row-key") === rowKey;
}

/** Each grouping's last-seen section per open row (upstream `ua`), shared across sidebar mounts. */
const lastSectionOfRow = new Map<SessionListPrefs["groupBy"], Map<string, string>>();

/**
 * Upstream `$y`: when an open row first shows up in this section (or, grouped by status, moves into
 * it) while the section is collapsed, expand it, scroll the row into view and refocus it if it had focus.
 */
export function useOpenRowAutoExpand({
	groupBy,
	groupKey,
	rowKeys,
	openKeys,
	collapsed,
	customGroup,
	sectionRef,
}: {
	groupBy: SessionListPrefs["groupBy"];
	groupKey: string;
	rowKeys: readonly string[];
	openKeys: readonly string[];
	collapsed: boolean;
	customGroup: boolean;
	sectionRef: RefObject<HTMLElement | null>;
}): void {
	const pending = useRef<{rowKey: string; focus: boolean} | null>(null);
	useEffect(trackRowFocus, []);
	useLayoutEffect(() => {
		let seen = lastSectionOfRow.get(groupBy);
		if (seen === undefined) {
			seen = new Map();
			lastSectionOfRow.set(groupBy, seen);
		}
		for (const rowKey of openKeys) {
			const previous = seen.get(rowKey);
			if (previous === groupKey || !rowKeys.includes(rowKey)) continue;
			seen.set(rowKey, groupKey);
			const movesExpand = groupBy === "state" && !customGroup;
			if (collapsed && (previous === undefined || movesExpand)) {
				pending.current = {rowKey, focus: rowHasFocus(rowKey)};
				expandSidebarGroup(groupKey);
			}
		}
	}, [groupBy, groupKey, rowKeys, openKeys, collapsed, customGroup]);
	useEffect(() => {
		const target = pending.current;
		if (target === null || collapsed) return;
		pending.current = null;
		const row = sectionRef.current?.querySelector(`[data-row-key="${CSS.escape(target.rowKey)}"]`);
		row?.scrollIntoView({block: "nearest"});
		if (target.focus) row?.querySelector<HTMLElement>("[data-row-main-button]")?.focus();
	}, [collapsed, sectionRef]);
}

function focusable(element: Element): element is HTMLElement {
	return (
		element instanceof HTMLElement &&
		element.isConnected &&
		(typeof element.checkVisibility !== "function" || element.checkVisibility()) &&
		element.closest("[inert]") === null
	);
}

/**
 * Upstream `gb`: when this section unmounts holding focus, move focus to the same section's toggle if
 * it remounted, else the nearest following group toggle, else the nearest preceding one.
 */
export function useSectionFocusRescue(groupKey: string, sectionRef: RefObject<HTMLElement | null>): void {
	useLayoutEffect(
		() => () => {
			const section = sectionRef.current;
			const list = section?.closest("[data-testid=sidebar-recents]");
			const active = section?.ownerDocument.activeElement;
			if (!section || !list || !active || !section.contains(active)) return;
			const doc = section.ownerDocument;
			const others = [...list.querySelectorAll(GROUP_TOGGLE)].filter((toggle) => !section.contains(toggle));
			const follows = (toggle: Element) =>
				(section.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
			const candidates = [...others.filter(follows), ...others.filter((toggle) => !follows(toggle)).toReversed()];
			const focusVisible = active.matches(":focus-visible");
			queueMicrotask(() => {
				if (!focusLost(doc)) return;
				const same = list.querySelector(`[data-group-key="${CSS.escape(groupKey)}"] ${GROUP_TOGGLE}`);
				const next = [same, ...candidates].find((toggle) => toggle !== null && focusable(toggle));
				if (next instanceof HTMLElement) next.focus({focusVisible});
			});
		},
		[groupKey, sectionRef],
	);
}
