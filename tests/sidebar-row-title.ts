/**
 * A sidebar row's visible text: its `textContent` without upstream's sr-only status and
 * environment spans (`[data-find-omitted]`), which sit inside the title.
 */
export function rowTitle(element: Element): string;
export function rowTitle(element: Element | null | undefined): string | undefined;
export function rowTitle(element: Element | null | undefined): string | undefined {
	if (element === null || element === undefined) return undefined;
	const clone = element.cloneNode(true);
	if (!(clone instanceof Element)) throw new Error("cloned a non-element");
	for (const node of clone.querySelectorAll("[data-find-omitted]")) node.remove();
	return clone.textContent;
}
