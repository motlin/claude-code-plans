import {type RefObject, useEffect, useLayoutEffect, useMemo, useRef} from "react";

import {
	EDITABLE_SELECTOR,
	handoffTargets,
	isModalDialog,
	nextOpenOverlayAfter,
	overlayHoldingFocus,
	parentRefocus,
	registerDialogPopup,
	safeFocusTarget,
	walkOpenerChain,
} from "../../lib/overlay-focus";

type CloseType = "keyboard" | "mouse" | "touch" | "pen" | "";

export type FinalFocus = (closeType: CloseType) => HTMLElement | boolean | null;

export type DialogPopupRef = ((element: HTMLElement | null) => void) & RefObject<HTMLElement | null>;

interface Options {
	open: boolean;
	modal?: boolean;
	triggerRef?: RefObject<Element | null> | undefined;
}

interface Chain {
	targets: Element[];
	dialog: Element | null;
}

function htmlElement(value: unknown): HTMLElement | null {
	return value instanceof HTMLElement ? value : null;
}

function isConnected(element: Element): boolean {
	return element.isConnected;
}

function popupDocument(popup: Element | null): Document {
	return popup?.ownerDocument ?? document;
}

/** Upstream `eI`: blur a background element, dropping the `relatedTarget` the blur would carry. */
function blurWithoutRelatedTarget(element: Element) {
	const scrub = (event: Event) => {
		if (event instanceof FocusEvent && event.relatedTarget !== null) {
			Object.defineProperty(event, "relatedTarget", {value: null});
		}
	};
	element.addEventListener("blur", scrub, {capture: true, once: true});
	element.addEventListener("focusout", scrub, {capture: true, once: true});
	htmlElement(element)?.blur();
	element.removeEventListener("blur", scrub, {capture: true});
	element.removeEventListener("focusout", scrub, {capture: true});
}

/**
 * Upstream `Eo(open, modal, triggerRef)` (shared-frame, with its open tracker `Vg`): the dialog popup's
 * `finalFocus`. It returns to the opener, walks menu openers when the opener unmounted, hands its return
 * target to another open overlay that holds focus at close, and refocuses a parent dialog when nothing
 * else is left.
 */
export function useDialogFinalFocus({open, modal = true, triggerRef}: Options): {
	finalFocus: FinalFocus;
	popupRef: DialogPopupRef;
} {
	const elementRef = useRef<HTMLElement | null>(null);
	const openerRef = useRef<Element | null>(null);
	const chainRef = useRef<Chain>({targets: [], dialog: null});
	const triggerFallbackRef = useRef<Element | null>(null);
	const openedRef = useRef(false);
	const pendingRef = useRef(false);
	const unmountedRef = useRef(false);

	const popupRef = useMemo(() => {
		const ref: DialogPopupRef = Object.assign(
			(element: HTMLElement | null) => {
				elementRef.current = element;
				ref.current = element;
				registerDialogPopup(element, modal);
			},
			{current: elementRef.current},
		);
		return ref;
	}, [modal]);

	// Upstream `Vg`: record the opener and its chain once per open.
	useLayoutEffect(() => {
		if (!open) {
			openedRef.current = false;
			return;
		}
		if (openedRef.current) return;
		openedRef.current = true;
		triggerFallbackRef.current = null;
		pendingRef.current = true;
		const doc = popupDocument(elementRef.current);
		const active = doc.activeElement;
		const opener = active !== null && active !== doc.body ? active : null;
		openerRef.current = opener;
		chainRef.current = walkOpenerChain(opener);
	}, [open]);

	// Upstream effect `p`: the trigger fallback, and a modal's blur of a background element still focused.
	useEffect(() => {
		if (!pendingRef.current) return;
		pendingRef.current = false;
		if (!modal && triggerRef === undefined) return;
		const popup = elementRef.current;
		const doc = popupDocument(popup);
		if (openerRef.current === null) {
			const trigger = triggerRef?.current ?? null;
			triggerFallbackRef.current =
				trigger?.isConnected === true && popup?.contains(trigger) !== true ? trigger : null;
		}
		if (!modal) return;
		const active = doc.activeElement;
		const outside = active !== null && active !== doc.body ? active : null;
		if (outside !== null && popup?.contains(outside) !== true) blurWithoutRelatedTarget(outside);
	}, [open, modal, triggerRef]);

	useEffect(() => {
		unmountedRef.current = false;
		return () => {
			unmountedRef.current = true;
		};
	}, []);

	return useMemo(() => {
		/** Upstream `y`: a parent modal dialog to refocus once this popup is gone. */
		const parentDialog = (): HTMLElement | null => {
			const popup = elementRef.current;
			if (!unmountedRef.current && popup?.isConnected === true && popup.hasAttribute("data-open")) return null;
			const candidates = [
				chainRef.current.dialog,
				popup === null ? undefined : handoffTargets.get(popup),
				popup === null ? undefined : parentRefocus.get(popup),
			];
			return htmlElement(
				candidates.find(
					(candidate) =>
						candidate !== null &&
						candidate !== undefined &&
						candidate !== popup &&
						isModalDialog(candidate) &&
						candidate.isConnected &&
						candidate.hasAttribute("data-open"),
				),
			);
		};

		/** Upstream `b`: this popup's return target, to hand to the overlay holding focus. */
		const returnTarget = (): Element | null => {
			const opener = openerRef.current;
			const fallback = triggerFallbackRef.current;
			const target =
				opener === null
					? fallback?.isConnected === true
						? fallback
						: null
					: opener.isConnected
						? opener
						: chainRef.current.targets.find(isConnected);
			const popup = elementRef.current;
			return htmlElement(target) ?? (popup === null ? undefined : handoffTargets.get(popup)) ?? parentDialog();
		};

		/** Upstream `x`: a target handed to this popup, while focus is idle. */
		const handedTarget = (): Element | null => {
			const popup = elementRef.current;
			const target = popup === null ? undefined : handoffTargets.get(popup);
			if (target?.isConnected !== true || isModalDialog(target)) return null;
			const active = popupDocument(popup).activeElement;
			return active === null || active === popupDocument(popup).body || popup?.contains(active) === true
				? target
				: null;
		};

		/** Upstream `S`. */
		const resolve = (): HTMLElement | false | null => {
			const popup = elementRef.current;
			const doc = popupDocument(popup);
			if (!modal) {
				const active = doc.activeElement;
				if (active !== null && active !== doc.body && popup?.contains(active) !== true) return false;
			}
			const opener = openerRef.current;
			if (opener !== null) {
				if (!opener.isConnected) {
					const target = chainRef.current.targets.find(isConnected);
					if (target !== undefined) return safeFocusTarget(target, popup);
					const handed = handedTarget();
					if (handed !== null) return safeFocusTarget(handed, popup);
				}
				return safeFocusTarget(opener, popup);
			}
			const fallback = triggerFallbackRef.current;
			if (fallback !== null) {
				const active = doc.activeElement;
				return (active !== null && active.matches(EDITABLE_SELECTOR) && popup?.contains(active) !== true) ||
					!fallback.isConnected
					? false
					: null;
			}
			const handed = handedTarget();
			return handed === null ? false : safeFocusTarget(handed, popup);
		};

		/** Upstream `C`: refocus the parent dialog after close, or park it on a later overlay. */
		const refocusParent = (doc: Document) => {
			const parent = parentDialog();
			const popup = elementRef.current;
			if (parent === null) return;
			(doc.defaultView ?? window).setTimeout(() => {
				const active = doc.activeElement;
				const idle =
					active === null ||
					active === doc.body ||
					(popup?.contains(active) === true && !popup.hasAttribute("data-open"));
				if (!parent.isConnected || !parent.hasAttribute("data-open")) return;
				const later = nextOpenOverlayAfter(doc, parent);
				if (later === null) {
					if (idle) parent.focus({preventScroll: true});
				} else if (!parentRefocus.has(later)) parentRefocus.set(later, parent);
			}, 0);
		};

		const finalFocus: FinalFocus = (closeType) => {
			const popup = elementRef.current;
			const doc = popupDocument(popup);
			const holder = modal ? overlayHoldingFocus(doc, popup) : null;
			refocusParent(doc);
			if (holder === null) return resolve();
			const target = returnTarget();
			if (target !== null && !holder.contains(target)) handoffTargets.set(holder, target);
			queueMicrotask(() => {
				if (holder.isConnected || doc.activeElement !== doc.body) return;
				htmlElement(resolve() ?? triggerFallbackRef.current)?.focus({
					preventScroll: true,
					...(closeType === "keyboard" && {focusVisible: true}),
				});
			});
			return false;
		};

		return {finalFocus, popupRef};
	}, [modal, popupRef]);
}
