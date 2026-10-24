// Geometry stubs that run on every scrollTop, scrollHeight and rect read spent most of their time in jsdom's selector
// engine. These plain walks return what querySelectorAll and closest return for a single attribute, in the same order.

/** The elements under `root`, in document order, that `accept` takes; stops after `limit` of them. */
function descendants(root: Node, accept: (element: HTMLElement) => boolean, limit = Infinity): HTMLElement[] {
	const found: HTMLElement[] = [];
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
	for (let node = walker.nextNode(); node && found.length < limit; node = walker.nextNode()) {
		if (node instanceof HTMLElement && accept(node)) found.push(node);
	}
	return found;
}

/** `element.closest(`[${attribute}]`)`. */
export function ancestorWith(element: Element, attribute: string): Element | null {
	for (let current: Element | null = element; current; current = current.parentElement) {
		if (current.hasAttribute(attribute)) return current;
	}
	return null;
}

/** The transcript rows mounted under `root`: `root.querySelectorAll("[data-transcript-entry-index]")`. */
export function transcriptRows(root: Node): HTMLElement[] {
	return descendants(root, (element) => element.hasAttribute("data-transcript-entry-index"));
}

/** The row's `data-transcript-entry-index`. */
export function entryIndex(row: Element): number {
	return Number(row.getAttribute("data-transcript-entry-index"));
}

/** The pixel height of the virtualizer's spacer on `position`'s side under `root`, or 0 without one. */
export function transcriptSpacerHeight(root: Node, position: "before" | "after"): number {
	const [spacer] = descendants(root, (element) => element.getAttribute("data-transcript-spacer") === position, 1);
	return Number.parseFloat(spacer?.style.height ?? "0");
}
