import {findMatches} from "../../lib/find-in-file";

/**
 * Text is searched per block so a match never spans two source rows or two
 * markdown paragraphs; token spans inside one block still join up.
 */
const FIND_BLOCK_SELECTOR = '[role="row"], p, li, h1, h2, h3, h4, h5, h6, td, th, pre, blockquote, dt, dd, figcaption';

export interface FindBlock {
	block: Element;
	ranges: Range[];
}

/** DOM ranges of every `query` match under `root`, grouped by block in document order. */
export function collectFindBlocks(root: Element, query: string): FindBlock[] {
	if (query === "") return [];
	const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
		acceptNode: (node) =>
			node.parentElement?.closest("[data-find-ignore]") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
	});
	const groups: {block: Element; nodes: [Text, ...Text[]]}[] = [];
	for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
		const text = node as Text;
		const block = text.parentElement?.closest(FIND_BLOCK_SELECTOR) ?? root;
		const last = groups.at(-1);
		if (last?.block === block) last.nodes.push(text);
		else groups.push({block, nodes: [text]});
	}
	return groups.flatMap(({block, nodes}) => {
		const starts: number[] = [];
		let joined = "";
		for (const node of nodes) {
			starts.push(joined.length);
			joined += node.data;
		}
		const locate = (offset: number, isEnd: boolean): [Text, number] => {
			const threshold = offset - (isEnd ? 1 : 0);
			let located: [Text, number] = [nodes[0], offset];
			for (const [index, node] of nodes.entries()) {
				const start = starts[index] ?? 0;
				if (index > 0 && start > threshold) break;
				located = [node, offset - start];
			}
			return located;
		};
		const ranges = findMatches(joined, query).map(({start, end}) => {
			const range = root.ownerDocument.createRange();
			range.setStart(...locate(start, false));
			range.setEnd(...locate(end, true));
			return range;
		});
		return ranges.length === 0 ? [] : [{block, ranges}];
	});
}

const MATCH_HIGHLIGHT = "file-find";
const ACTIVE_HIGHLIGHT = "file-find-active";

function highlightRegistry(): HighlightRegistry | undefined {
	return typeof CSS !== "undefined" && "highlights" in CSS ? CSS.highlights : undefined;
}

/** Paint matches with the CSS Custom Highlight API, where the browser has it. */
export function paintFindHighlights(ranges: readonly Range[], active: Range | null): void {
	const registry = highlightRegistry();
	if (registry === undefined || typeof Highlight === "undefined") return;
	registry.set(MATCH_HIGHLIGHT, new Highlight(...ranges));
	registry.set(ACTIVE_HIGHLIGHT, active === null ? new Highlight() : new Highlight(active));
}

export function clearFindHighlights(): void {
	const registry = highlightRegistry();
	registry?.delete(MATCH_HIGHLIGHT);
	registry?.delete(ACTIVE_HIGHLIGHT);
}
