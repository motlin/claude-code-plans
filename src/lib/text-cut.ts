/**
 * Upstream `JC`: whether an element's text is cut off, by a scroll overflow or by its text range's box
 * passing either edge by more than 0.1px (a subpixel truncation that `scrollWidth` rounds away).
 */
export function isTextCut(element: HTMLElement | null): boolean
{
	if (element === null) return false;
	if (element.scrollWidth > element.clientWidth) return true;
	const range = element.ownerDocument.createRange();
	range.selectNodeContents(element);
	// Some engines (jsdom) have no range geometry.
	const text = (range as Partial<Range>).getBoundingClientRect?.();
	if (text === undefined || text.width === 0) return false;
	const box = element.getBoundingClientRect();
	return text.right - box.right > 0.1 || box.left - text.left > 0.1;
}
