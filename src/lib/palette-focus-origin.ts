/**
 * Upstream's `Zn`: a weak reference to the last element focused outside the
 * command palette, which "Jump to question" cycles from and falls back to.
 * A document capture `focusin` updates it, skipping the palette and Base UI
 * focus guards; a `focusout` to nothing while no palette is open resets it.
 */
const PALETTE_SELECTOR = "[data-command-palette]";
const FOCUS_GUARD_SELECTOR = "[data-base-ui-focus-guard]";

let origin: WeakRef<Element> | null = null;

export function paletteFocusOrigin(): Element | null
{
	return origin?.deref() ?? null;
}

export function installPaletteFocusOrigin(doc: Document): () => void
{
	const onFocusIn = (event: FocusEvent) =>
	{
		const target = event.target;
		if (!(target instanceof Element)) return;
		if (target.closest(PALETTE_SELECTOR) !== null || target.closest(FOCUS_GUARD_SELECTOR) !== null) return;
		origin = new WeakRef(target);
	};
	const onFocusOut = (event: FocusEvent) =>
	{
		if (event.relatedTarget === null && doc.querySelector(PALETTE_SELECTOR) === null) origin = null;
	};
	doc.addEventListener("focusin", onFocusIn, true);
	doc.addEventListener("focusout", onFocusOut, true);
	return () =>
	{
		doc.removeEventListener("focusin", onFocusIn, true);
		doc.removeEventListener("focusout", onFocusOut, true);
		origin = null;
	};
}
