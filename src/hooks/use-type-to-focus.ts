import {type RefObject, useEffect, useRef} from "react";

import {cardOwnsDigit} from "../lib/approval-digits";
import {isButtonish, isEditableTarget, isInModalLayer, ownsTyping} from "../lib/shortcuts/match";
import {type Presence, presenceOf} from "../lib/stray-input-presence";

/**
 * Keys belong elsewhere inside any input or editable field, inside a menu, listbox, dialog or popper, and while
 * a modal or menu is open even if focus fell to the body, and while focus is inside `[data-owns-typing-and-pastes]`
 * (upstream's `Vo`, read from the active element), and during the wait after focus was inside an iframe. Space types
 * too, except from a control it presses or toggles (`cP`). A digit that the focused approval card takes stays with it
 * (upstream's `DP`).
 */
function claimsTypedKey(event: KeyboardEvent, presence: Presence): boolean
{
	if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return false;
	if (event.isComposing || event.defaultPrevented) return false;
	const target = event.target instanceof Element ? event.target : null;
	if (target instanceof HTMLInputElement || isEditableTarget(target) || isInModalLayer(target)) return false;
	if (ownsTyping(document.activeElement)) return false;
	if (event.key === " " && isButtonish(document.activeElement)) return false;
	if (cardOwnsDigit(event.key, document.activeElement)) return false;
	return document.querySelector('[aria-modal="true"],[role="menu"]') === null && presence.isPresent();
}

/**
 * Text inserts that arrive without a keydown: macOS dictation and other input methods send `beforeinput`
 * (insertText, insertReplacementText, insertFromComposition, insertFromPaste), a bare composition commit, or a paste. Like a typed key, they
 * belong to whatever field, menu or dialog holds them, and the composer takes them only from outside all of those.
 */
function claimsInsert(target: EventTarget | null, defaultPrevented: boolean, presence: Presence): boolean
{
	if (defaultPrevented) return false;
	const element = target instanceof Element ? target : null;
	if (element instanceof HTMLInputElement || isEditableTarget(element) || isInModalLayer(element)) return false;
	if (ownsTyping(document.activeElement)) return false;
	return document.querySelector('[aria-modal="true"],[role="menu"]') === null && presence.isPresent();
}

const ROUTED_INPUT_TYPES = new Set(["insertText", "insertReplacementText", "insertFromComposition", "insertFromPaste"]);

function insertedText(event: InputEvent): string
{
	return event.data ?? event.dataTransfer?.getData("text/plain") ?? "";
}

/**
 * Types `text` into a controlled textarea at its caret. setRangeText skips React's value tracker, so the
 * dispatched `input` event reads as a change and onChange sees it like a real keystroke.
 */
export function insertAtCaret(textarea: HTMLTextAreaElement, text: string): void
{
	textarea.setRangeText(text, textarea.selectionStart, textarea.selectionEnd, "end");
	textarea.dispatchEvent(
		new Event(
			"input",
			{
				bubbles: true,
			},
		),
	);
}

/**
 * Upstream's global type-to-focus: a printable key pressed outside any editable field moves focus into the
 * active composer and types the character there at its caret. Dictated, composed or pasted text inserted with
 * no editable focus (no keydown at all) takes the same route. The insert goes through `setRangeText`
 * and an `input` event, so React's onChange (and the draft store) sees it like a real keystroke.
 * `onRoutedText` sees routed text first (upstream's `Tc`); when it returns true the composer is focused and the
 * text isn't inserted. After focus has been inside an iframe, nothing routes until a press and click in the page
 * (upstream's `za` wait); like upstream in a session, the dropped text gets no toast.
 */
export function useTypeToFocus(
	textareaRef: RefObject<HTMLTextAreaElement | null>,
	enabled: boolean,
	onRoutedText?: (text: string) => boolean,
): void
{
	const onRoutedTextRef = useRef(onRoutedText);
	onRoutedTextRef.current = onRoutedText;
	useEffect(() =>
	{
		if (!enabled) return undefined;
		const presence = presenceOf(window);
		const target = (): HTMLTextAreaElement | null =>
		{
			const textarea = textareaRef.current;
			return textarea === null || textarea.disabled ? null : textarea;
		};
		const insert = (textarea: HTMLTextAreaElement, text: string) =>
		{
			textarea.focus();
			if (onRoutedTextRef.current?.(text) === true) return;
			insertAtCaret(textarea, text);
		};
		// A composition whose text a beforeinput already routed must not insert again on compositionend.
		let compositionRouted = false;
		const onKeyDown = (event: KeyboardEvent) =>
		{
			const textarea = target();
			if (textarea === null || !claimsTypedKey(event, presence)) return;
			event.preventDefault();
			insert(textarea, event.key);
		};
		const onBeforeInput = (event: InputEvent) =>
		{
			if (!ROUTED_INPUT_TYPES.has(event.inputType)) return;
			const textarea = target();
			const text = insertedText(event);
			if (textarea === null || text === "" || !claimsInsert(event.target, event.defaultPrevented, presence))
				return;
			event.preventDefault();
			if (event.inputType === "insertFromComposition") compositionRouted = true;
			insert(textarea, text);
		};
		// Cmd-V (and dictation tools like Wispr Flow that paste through a synthetic Cmd-V) fires `paste` on the
		// focused element even when it isn't editable, and the browser then drops the text. Plain-text pastes
		// take the same route as a dictated insert; file pastes stay with whatever handles them.
		const onPaste = (event: ClipboardEvent) =>
		{
			const textarea = target();
			const data = event.clipboardData;
			if (textarea === null || data === null || data.files.length > 0) return;
			const text = data.getData("text/plain");
			if (text === "" || !claimsInsert(event.target, event.defaultPrevented, presence)) return;
			event.preventDefault();
			insert(textarea, text);
		};
		const onCompositionStart = () =>
		{
			compositionRouted = false;
		};
		const onCompositionEnd = (event: CompositionEvent) =>
		{
			const routed = compositionRouted;
			compositionRouted = false;
			const textarea = target();
			if (routed || textarea === null || event.data === "" || !claimsInsert(event.target, false, presence))
				return;
			insert(textarea, event.data);
		};
		window.addEventListener("keydown", onKeyDown);
		window.addEventListener("beforeinput", onBeforeInput);
		window.addEventListener("paste", onPaste);
		window.addEventListener("compositionstart", onCompositionStart);
		window.addEventListener("compositionend", onCompositionEnd);
		return () =>
		{
			window.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("beforeinput", onBeforeInput);
			window.removeEventListener("paste", onPaste);
			window.removeEventListener("compositionstart", onCompositionStart);
			window.removeEventListener("compositionend", onCompositionEnd);
		};
	}, [textareaRef, enabled]);
}
