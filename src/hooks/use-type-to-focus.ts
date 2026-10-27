import {type RefObject, useEffect} from "react";

import {isEditableTarget, isInModalLayer} from "../lib/shortcuts/match";

/**
 * Keys belong elsewhere inside any input or editable field, inside a menu, listbox, dialog or popper, and while
 * a modal or menu is open even if focus fell to the body. Space only types from the body: on a control it presses.
 */
function claimsTypedKey(event: KeyboardEvent): boolean {
	if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return false;
	if (event.isComposing || event.defaultPrevented) return false;
	const target = event.target instanceof Element ? event.target : null;
	if (target instanceof HTMLInputElement || isEditableTarget(target) || isInModalLayer(target)) return false;
	if (event.key === " " && target !== document.body) return false;
	return document.querySelector('[aria-modal="true"],[role="menu"]') === null;
}

/**
 * Upstream's global type-to-focus: a printable key pressed outside any editable field moves focus into the
 * active composer and types the character there at its caret. The insert goes through `setRangeText`
 * and an `input` event, so React's onChange (and the draft store) sees it like a real keystroke.
 */
export function useTypeToFocus(textareaRef: RefObject<HTMLTextAreaElement | null>, enabled: boolean): void {
	useEffect(() => {
		if (!enabled) return undefined;
		const onKeyDown = (event: KeyboardEvent) => {
			const textarea = textareaRef.current;
			if (textarea === null || textarea.disabled) return;
			if (!claimsTypedKey(event)) return;
			event.preventDefault();
			textarea.focus();
			// setRangeText skips React's value tracker, so the input event reads as a change.
			textarea.setRangeText(event.key, textarea.selectionStart, textarea.selectionEnd, "end");
			textarea.dispatchEvent(new Event("input", {bubbles: true}));
		};
		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [textareaRef, enabled]);
}
