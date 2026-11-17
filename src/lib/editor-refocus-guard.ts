/*
 * Upstream's editor refocus guards and `aY` (shared-5): when a change empties the draft while the editor is
 * unfocused, focus comes back to it unless an overlay or another visible field holds focus.
 */

/** Upstream `bT`: focus inside one of these (that doesn't contain the editor) is an overlay's. */
const OVERLAY_FOCUS_SELECTOR =
	'[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"], [data-radix-dialog-content], [data-cds="AskUserQuestion"]';

/** Upstream `qM`: focus in one of these is another field's. */
const FIELD_FOCUS_SELECTOR = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

/** Upstream `cV`: embedded documents that hold focus themselves. */
const EMBED_FOCUS_SELECTOR = "iframe, object, embed";

/** The focused element outside `editor`, or null when focus is idle or inside it. */
function outsideFocus(editor: HTMLElement): Element | null
{
	const active = editor.ownerDocument.activeElement;
	if (active === null || editor.contains(active)) return null;
	return active;
}

/** Upstream `bq`: focus is held by an overlay that doesn't contain the editor. */
export function focusHeldByOverlay(editor: HTMLElement): boolean
{
	const overlay = outsideFocus(editor)?.closest(OVERLAY_FOCUS_SELECTOR);
	return overlay !== null && overlay !== undefined && !overlay.contains(editor);
}

/** Upstream `H1`: visible, or the browser can't tell. */
function isVisible(element: Element): boolean
{
	return (
		typeof element.checkVisibility !== "function" ||
		element.checkVisibility(
			{
				visibilityProperty: true,
			},
		)
	);
}

/** Upstream `H_`: focus is held by another visible field or an embed. */
export function focusHeldByField(editor: HTMLElement): boolean
{
	const active = outsideFocus(editor);
	if (active === null) return false;
	const field = active.matches(EMBED_FOCUS_SELECTOR) ? active : active.closest(FIELD_FOCUS_SELECTOR);
	return field !== null && isVisible(field);
}

/** Upstream `rj`: a touch screen, where mount and swap focus would raise the keyboard. */
export function isCoarsePointer(): boolean
{
	return typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches && navigator.maxTouchPoints > 0;
}

function canTakeFocus(editor: HTMLTextAreaElement): boolean
{
	return editor.isConnected && !focusHeldByOverlay(editor) && !focusHeldByField(editor);
}

/** Upstream `aY`: caret to the end, focus now, and once more on the next frame if it didn't stick. */
export function refocusEmptiedEditor(editor: HTMLTextAreaElement): void
{
	const end = editor.value.length;
	if (editor.selectionStart !== end || editor.selectionEnd !== end) editor.setSelectionRange(end, end);
	if (canTakeFocus(editor)) editor.focus();
	requestAnimationFrame(() =>
	{
		if (editor.ownerDocument.activeElement !== editor && canTakeFocus(editor)) editor.focus();
	});
}
