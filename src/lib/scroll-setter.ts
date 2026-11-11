/**
 * Upstream's shared programmatic scroll setter (shared-31 `gT` over the `HY` WeakMap): a scroller's owner registers
 * the setter that keeps its own scroll bookkeeping in step, and other code writes offsets through it.
 */
const setters = new WeakMap<Element, (top: number) => void>();

/** Registers `setter` as the way to write `element`'s scrollTop; the returned cleanup removes it if still current. */
export function registerScrollSetter(element: Element, setter: (top: number) => void): () => void {
	setters.set(element, setter);
	return () => {
		if (setters.get(element) === setter) setters.delete(element);
	};
}

/** Upstream `gT`: writes through the registered setter, else a plain scrollTop write. */
export function setScrollTop(element: Element, top: number): void {
	const setter = setters.get(element);
	if (setter === undefined) element.scrollTop = top;
	else setter(top);
}
