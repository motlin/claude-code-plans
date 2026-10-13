/**
 * The element that actually scrolls above `node`. The app scrolls `<main>`, not
 * the window, so `window.scrollY` is a dead end here; walking up to the nearest
 * `overflow-y` ancestor keeps this correct wherever the transcript is mounted,
 * and falls back to the document scroller when nothing else scrolls.
 */
export function findScrollContainer(node: Element | null): Element {
	for (let element = node?.parentElement ?? null; element; element = element.parentElement) {
		const {overflowY} = getComputedStyle(element);
		if (overflowY === "auto" || overflowY === "scroll") return element;
	}
	return document.scrollingElement ?? document.documentElement;
}

/**
 * The `root` an IntersectionObserver should measure against, given the element
 * that scrolls. `null` means the viewport, which is only right when the
 * document itself scrolls: the app shell scrolls `<main>` while leaving the
 * document parked partway down, so a viewport-rooted observer would call the
 * top of the transcript "off screen" no matter where the reader scrolled to.
 */
export function toObserverRoot(scroller: Element): Element | null {
	if (scroller === document.documentElement) return null;
	if (scroller === document.scrollingElement) return null;
	return scroller;
}
