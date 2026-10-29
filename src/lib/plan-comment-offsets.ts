/**
 * Offsets for Plan pane comments: positions in the pane's flattened text, the concatenation of
 * its text nodes minus code blocks (`pre`, or anything under `[data-plan-comment-skip]`), as
 * upstream counts them, so a comment keeps pointing at the same words across re-renders.
 */

const SKIP_SELECTOR = "pre, [data-plan-comment-skip]";

function commentableTextNodes(root: Element): Text[] {
	const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
		acceptNode: (node) => {
			const skip = node.parentElement?.closest(SKIP_SELECTOR);
			return skip !== null && skip !== undefined && root.contains(skip)
				? NodeFilter.FILTER_REJECT
				: NodeFilter.FILTER_ACCEPT;
		},
	});
	const nodes: Text[] = [];
	for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
		if (node instanceof Text) nodes.push(node);
	}
	return nodes;
}

export interface FlattenedSelection {
	start: number;
	end: number;
	text: string;
}

/**
 * `range`'s `[start, end)` in the root's flattened text and the text it covers, clipped to the
 * root; null when it covers no commentable text or only whitespace.
 */
export function flattenOffsets(root: Element, range: Range): FlattenedSelection | null {
	const clipped = range.cloneRange();
	const bounds = root.ownerDocument.createRange();
	bounds.selectNodeContents(root);
	if (clipped.compareBoundaryPoints(Range.START_TO_START, bounds) < 0) clipped.setStart(root, 0);
	if (clipped.compareBoundaryPoints(Range.END_TO_END, bounds) > 0) clipped.setEnd(root, root.childNodes.length);

	let position = 0;
	let start: number | null = null;
	let end = 0;
	let text = "";
	for (const node of commentableTextNodes(root)) {
		const length = node.data.length;
		if (clipped.intersectsNode(node)) {
			const from = node === clipped.startContainer ? clipped.startOffset : 0;
			const to = node === clipped.endContainer ? clipped.endOffset : length;
			if (to > from) {
				start ??= position + from;
				end = position + to;
				text += node.data.slice(from, to);
			}
		}
		position += length;
	}
	if (start === null || text.trim() === "") return null;
	return {start, end, text};
}

/** The DOM range over `[start, end)` of the root's flattened text, or null when it runs past the text. */
export function rangeFromOffsets(root: Element, start: number, end: number): Range | null {
	const range = root.ownerDocument.createRange();
	let position = 0;
	let startSet = false;
	for (const node of commentableTextNodes(root)) {
		const length = node.data.length;
		if (!startSet && start < position + length) {
			range.setStart(node, start - position);
			startSet = true;
		}
		if (startSet && end <= position + length) {
			range.setEnd(node, end - position);
			return range;
		}
		position += length;
	}
	return null;
}
