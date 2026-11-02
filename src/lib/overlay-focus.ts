import {OPEN_OVERLAY_SELECTOR, OVERLAY_ATTR} from "./overlay";

/*
 * Upstream's stacked-overlay focus registries (shared-frame `Wt`, `gg`, `Ug`, `g$`) and helpers (`Wm`, `bD`,
 * `uY`, `op`, `TH`). Every dialog popup registers as modal or not; every Menu/Popover popup registers a getter
 * for "who opened me", so a dialog opened from a menu item can find its way back once the item unmounts.
 */

/** Upstream `Ms`: the most opener hops `walkOpenerChain` takes. */
export const MAX_CHAIN = 8;

/** Upstream `FB`: focus in one of these outside the closing popup is never stolen. */
export const EDITABLE_SELECTOR =
	"input:not([type='hidden']):not([disabled]),[contenteditable]:not([contenteditable='false']),textarea:not([disabled])";

const INERT_SELECTOR = '[aria-hidden="true"], [inert]';

const dialogs = new WeakMap<Element, boolean>();
const openerReturns = new WeakMap<Element, () => Element | null>();

/** Upstream `Ug`: a focus-return target handed to another open overlay. */
export const handoffTargets = new WeakMap<Element, Element>();

/** Upstream `g$`: a parent dialog to refocus when the later overlay closes. */
export const parentRefocus = new WeakMap<Element, Element>();

/** Upstream `FV` (modal) / `Kb` (non-modal), the dialog popup's ref callback. */
export function registerDialogPopup(element: Element | null, modal: boolean): void
{
	if (element !== null) dialogs.set(element, modal);
}

/** Upstream `Ha`. */
export function isModalDialog(element: Element): boolean
{
	return dialogs.get(element) === true;
}

/** Upstream `Sh`: a Menu/Popover popup's "who opened me" getter. */
export function registerOpenerReturn(popup: Element, getter: () => Element | null): void
{
	openerReturns.set(popup, getter);
}

/** Upstream `Wm`: menu triggers between the opener and the dialog that holds it. */
export function walkOpenerChain(opener: Element | null):
{
	targets: Element[];
	dialog: Element | null;
}
{
	const targets: Element[] = [];
	let node = opener;
	while (node !== null && targets.length < MAX_CHAIN)
	{
		if (dialogs.has(node))
			return {
				targets,
				dialog: node,
			};
		const getter = openerReturns.get(node);
		if (getter === undefined)
		{
			node = node.parentElement;
			continue;
		}
		const next = getter();
		if (next === null || next === node || targets.includes(next)) break;
		targets.push(next);
		node = next;
	}
	return {
		targets,
		dialog: null,
	};
}

/** Upstream `bD`: the open overlay holding focus, unless focus is idle or inside `popup`. */
export function overlayHoldingFocus(doc: Document, popup: Element | null): Element | null
{
	const active = doc.activeElement;
	if (active === null || active === doc.body || popup?.contains(active) === true) return null;
	const overlay = active.closest(`[${OVERLAY_ATTR}]`);
	return overlay?.matches(OPEN_OVERLAY_SELECTOR) === true ? overlay : null;
}

/** Upstream `uY`: the first open overlay after `element` in document order, outside inert/aria-hidden trees. */
export function nextOpenOverlayAfter(doc: Document, element: Element): Element | null
{
	for (const node of doc.querySelectorAll(OPEN_OVERLAY_SELECTOR))
	{
		if (
			node !== element &&
			node.closest(INERT_SELECTOR) === null &&
			(element.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
		)
		{
			return node;
		}
	}
	return null;
}

/** Upstream `op`: the nearest open registered modal dialog at or above `element`. */
export function openModalAncestor(element: Element): Element | null
{
	for (let node: Element | null = element; node !== null; node = node.parentElement)
	{
		if (isModalDialog(node) && node.hasAttribute("data-open")) return node;
	}
	return null;
}

/**
 * Upstream `TH`: the target to hand Base UI, or `false` to leave focus alone. A `tabIndex<0` target is focused
 * here (Base UI would focus its first tabbable child instead).
 */
export function safeFocusTarget(target: Element | null | undefined, popup: Element | null): HTMLElement | false
{
	if (target?.isConnected !== true || !(target instanceof HTMLElement)) return false;
	const active = target.ownerDocument.activeElement;
	if (active !== null && active.matches(EDITABLE_SELECTOR) && popup?.contains(active) !== true) return false;
	if (active !== null && openModalAncestor(active)?.contains(target) === false) return false;
	if (target.tabIndex < 0)
	{
		target.focus(
			{
				preventScroll: true,
			},
		);
		return false;
	}
	return target;
}

/**
 * Upstream `iR`'s `Sh(popup, () => triggerIfConnected ?? openerAtOpen)` as a Menu/Popover popup ref callback:
 * the trigger is the element whose `aria-controls` names the popup, and the opener is what held focus when
 * the popup mounted.
 */
export function registerPopupOpener(popup: HTMLElement | null): void
{
	if (popup === null) return;
	const doc = popup.ownerDocument;
	const active = doc.activeElement;
	const openerAtOpen = active !== null && active !== doc.body && !popup.contains(active) ? active : null;
	const trigger =
		popup.id === ""
			? null
			: ([...doc.querySelectorAll("[aria-controls]")].find(
					(element) => element.getAttribute("aria-controls") === popup.id,
				) ?? null);
	registerOpenerReturn(popup, () => (trigger?.isConnected === true ? trigger : openerAtOpen));
}
