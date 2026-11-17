import {useSyncExternalStore} from "react";

import {isAnotherOverlayOpen} from "./overlay";

/**
 * Upstream's sidebar jump hints (shared-21 `SX`/`v7`/`qS`/`If`/`Kt`/`Hf`/`Qg`): hold Ctrl+Shift for
 * 200ms and the first nine visible session rows show a digit keycap; Ctrl+Shift+1…9 opens that row.
 */
export const JUMP_DIGITS = "123456789";

/** Upstream `F3`: how long the chord must be held before the keycaps show. */
export const JUMP_HOLD_MS = 200;

/** Upstream `Cx`: the keys that arm the hold timer rather than cancel it. */
export const JUMP_MODIFIER_KEYS: ReadonlySet<string> = new Set(["Shift", "Control", "Meta"]);

/** The session column the rows are collected from (upstream `.dframe-recents-by-mode [data-kind="code"]`). */
const JUMP_SCOPE_SELECTOR = '.df-session-list[data-kind="code"]';

const ROW_SELECTOR = "[data-jump-hint-row]";

/** Upstream `XO` without its desktop-only extra: the layers whose focus blocks the hints. */
const OVERLAY_FOCUS_SELECTOR = '[role="menu"],[role="listbox"],[role="dialog"],[role="alertdialog"]';

type ChordModifiers = Pick<KeyboardEvent, "ctrlKey" | "shiftKey" | "metaKey" | "altKey">;

/** Upstream `Hf`: exactly Ctrl+Shift, on every platform. */
export function isJumpChord(event: ChordModifiers): boolean
{
	return event.ctrlKey && event.shiftKey && !event.metaKey && !event.altKey;
}

/** Upstream `Kt`: a layout-independent key name, `Digit3` → "3", `KeyD` → "d". */
export function jumpKeyOf(event: Pick<KeyboardEvent, "code" | "key">): string | null
{
	if (event.code.startsWith("Digit")) return event.code.slice(5);
	const key = event.key.toLowerCase();
	const letter = key.length === 1 && key >= "a" && key <= "z";
	if (event.code.startsWith("Key")) return letter ? key : event.code.slice(3).toLowerCase();
	return letter ? key : null;
}

/**
 * Upstream `Qg`: focus in an INPUT, TEXTAREA or SELECT. Upstream's composer is a contenteditable, which
 * this gate never catches; the local composer is a textarea, so it opts out with
 * `data-jump-hint-passthrough`.
 */
export function isJumpGatedFocus(element: Element | null): boolean
{
	if (!(element instanceof HTMLElement)) return false;
	if (element.hasAttribute("data-jump-hint-passthrough")) return false;
	const tag = element.tagName;
	return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * Upstream `wn()` negated: focus sits in a modal menu, listbox or dialog (one with `aria-modal="false"`
 * doesn't count), or another overlay layer is open.
 */
export function jumpOverlayOwnsFocus(doc: Document = document): boolean
{
	const active = doc.activeElement;
	const layer = active === null ? null : active.closest(OVERLAY_FOCUS_SELECTOR);
	if (layer !== null && layer.getAttribute("aria-modal") !== "false") return true;
	return isAnotherOverlayOpen(doc);
}

/** Upstream `as`/`If`: visible rows in DOM order, first occurrence of each row key, at most nine. */
export function collectJumpRows(root: ParentNode | null): HTMLElement[]
{
	if (root === null) return [];
	const seen = new Set<string>();
	const rows: HTMLElement[] = [];
	for (const row of root.querySelectorAll<HTMLElement>(ROW_SELECTOR))
	{
		const key = row.getAttribute("data-row-key");
		if (key === null || seen.has(key)) continue;
		seen.add(key);
		if (row.offsetParent === null) continue;
		rows.push(row);
		if (rows.length >= JUMP_DIGITS.length) break;
	}
	return rows;
}

/** Upstream `v7`'s map: row key → digit, or null for an empty list. */
export function assignJumpHints(rows: readonly Element[]): Record<string, string> | null
{
	if (rows.length === 0) return null;
	const hints: Record<string, string> = {};
	for (const [index, row] of rows.entries())
	{
		const key = row.getAttribute("data-row-key");
		const digit = JUMP_DIGITS[index];
		if (key !== null && digit !== undefined) hints[key] = digit;
	}
	return hints;
}

export function jumpScope(doc: Document = document): Element | null
{
	return doc.querySelector(JUMP_SCOPE_SELECTOR);
}

let hintsByRowKey: Record<string, string> | null = null;
const listeners = new Set<() => void>();

function setHints(next: Record<string, string> | null): void
{
	hintsByRowKey = next;
	for (const listener of listeners) listener();
}

export function subscribeJumpHints(listener: () => void): () => void
{
	listeners.add(listener);
	return () =>
	{
		listeners.delete(listener);
	};
}

export function jumpHintsByRowKey(): Record<string, string> | null
{
	return hintsByRowKey;
}

export function jumpHintsShown(): boolean
{
	return hintsByRowKey !== null;
}

/** Upstream `v7`: number the visible rows under `root`; an empty list leaves the store as it is. */
export function showJumpHints(root: ParentNode | null): void
{
	const hints = assignJumpHints(collectJumpRows(root));
	if (hints !== null) setHints(hints);
}

/** Upstream `qS`: hide, notifying only when something was shown. */
export function clearJumpHints(): void
{
	if (hintsByRowKey !== null) setHints(null);
}

/** Upstream `z5`: the row key holding `digit`, if any. */
export function jumpRowKeyFor(digit: string): string | null
{
	const hints = hintsByRowKey;
	if (hints === null) return null;
	return Object.keys(hints).find((key) => hints[key] === digit) ?? null;
}

/** Upstream `xv`: one row's digit, re-rendering only that row's subscribers when it changes. */
export function useJumpHint(rowKey: string): string | null
{
	return useSyncExternalStore(
		subscribeJumpHints,
		() => hintsByRowKey?.[rowKey] ?? null,
		() => null,
	);
}

/** Tests only: set the shown map directly, as upstream's zustand `setState`. */
export function setJumpHintsForTest(next: Record<string, string> | null): void
{
	setHints(next);
}
