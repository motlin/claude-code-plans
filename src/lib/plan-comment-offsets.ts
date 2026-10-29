/**
 * Offsets for Plan pane comments: positions in the pane's flattened text, the concatenation of
 * its text nodes minus code blocks (`pre`, or anything under `[data-plan-comment-skip]`) and the
 * whitespace between table rows, as upstream counts them, so a comment keeps pointing at the same
 * words across re-renders.
 */

const SKIP_SELECTOR = "pre, [data-plan-comment-skip]";
/** Upstream's `ib`: table-structure elements whose whitespace-only text never counts. */
const TABLE_STRUCTURE = new Set(["TABLE", "THEAD", "TBODY", "TFOOT", "TR"]);

function isSkipped(root: Element, node: Node): boolean {
	const parent = node.parentElement;
	if (parent === null) return false;
	if (TABLE_STRUCTURE.has(parent.tagName) && /^\s*$/.test(node.textContent ?? "")) return true;
	const skip = parent.closest(SKIP_SELECTOR);
	return skip !== null && root.contains(skip);
}

function commentableTextNodes(root: Element): Text[] {
	const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
		acceptNode: (node) => (isSkipped(root, node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
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

/** The attribute naming the comment a mark belongs to. */
export const PLAN_COMMENT_ID_ATTR = "data-plan-comment-id";

export interface PlanCommentAnchor {
	id: string;
	selectedText: string;
	startOffset: number;
	endOffset: number;
}

function collapseWhitespace(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

/** Upstream's `db`: the occurrence of `text` in `flat` nearest `near`, or -1. */
function nearestOccurrence(flat: string, text: string, near: number): number {
	if (text === "") return -1;
	let best = -1;
	for (let index = flat.indexOf(text); index !== -1; index = flat.indexOf(text, index + 1)) {
		if (best === -1 || Math.abs(index - near) < Math.abs(best - near)) best = index;
	}
	return best;
}

/** Removes every comment mark under the root, leaving its text in place. */
export function unwrapPlanCommentMarks(root: Element): void {
	const marks = root.querySelectorAll(`mark[${PLAN_COMMENT_ID_ATTR}]`);
	if (marks.length === 0) return;
	for (const mark of marks) mark.replaceWith(root.ownerDocument.createTextNode(mark.textContent));
	root.normalize();
}

/**
 * Upstream's mark plugin (`lb`): wraps each comment's `[startOffset, endOffset)` slice of every text
 * node it covers in a mark made by `createMark`. A comment whose stored slice no longer matches its
 * text (whitespace collapsed) moves to the nearest occurrence of the text, or gets no mark.
 */
export function wrapPlanCommentMarks(
	root: Element,
	comments: readonly PlanCommentAnchor[],
	createMark: (id: string, text: string) => Element,
): void {
	const nodes: {node: Text; start: number}[] = [];
	let flat = "";
	for (const node of commentableTextNodes(root)) {
		nodes.push({node, start: flat.length});
		flat += node.data;
	}
	const ranges: {id: string; start: number; end: number}[] = [];
	for (const comment of comments) {
		let start = comment.startOffset;
		let end = comment.endOffset;
		if (collapseWhitespace(flat.slice(start, end)) !== collapseWhitespace(comment.selectedText)) {
			start = nearestOccurrence(flat, comment.selectedText, start);
			if (start === -1) continue;
			end = start + comment.selectedText.length;
		}
		ranges.push({id: comment.id, start, end});
	}
	for (const {node, start: nodeStart} of nodes) {
		const text = node.data;
		const nodeEnd = nodeStart + text.length;
		const covering = ranges
			.filter((range) => range.start < nodeEnd && range.end > nodeStart)
			.toSorted((a, b) => a.start - b.start);
		const parts: Node[] = [];
		let done = 0;
		for (const range of covering) {
			const from = Math.max(0, range.start - nodeStart);
			const to = Math.min(text.length, range.end - nodeStart);
			if (from < done || to <= from) continue;
			if (from > done) parts.push(root.ownerDocument.createTextNode(text.slice(done, from)));
			parts.push(createMark(range.id, text.slice(from, to)));
			done = to;
		}
		if (done === 0) continue;
		if (done < text.length) parts.push(root.ownerDocument.createTextNode(text.slice(done)));
		node.replaceWith(...parts);
	}
}
