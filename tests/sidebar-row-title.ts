/**
 * A sidebar row's visible text: its `textContent` without upstream's sr-only status and
 * environment spans (`[data-find-omitted]`), which sit inside the title, or a fold caret's
 * hidden name span (`[hidden]`).
 *
 * Walks the row's text nodes instead of cloning it: a list of 40+ rows read after every click
 * otherwise deep-clones each row, which dominated these tests' CPU time on a loaded machine.
 */
export function rowTitle(element: Element): string;
export function rowTitle(element: Element | null | undefined): string | undefined;
export function rowTitle(element: Element | null | undefined): string | undefined
{
	if (element === null || element === undefined) return undefined;
	const walker = element.ownerDocument.createTreeWalker(
		element,
		NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
		{
			acceptNode: (node) =>
				node instanceof Element && node !== element && node.matches("[data-find-omitted], [hidden]")
					? NodeFilter.FILTER_REJECT
					: NodeFilter.FILTER_ACCEPT,
		},
	);
	let text = "";
	for (let node = walker.nextNode(); node !== null; node = walker.nextNode())
	{
		if (node.nodeType === Node.TEXT_NODE) text += node.nodeValue ?? "";
	}
	return text;
}
