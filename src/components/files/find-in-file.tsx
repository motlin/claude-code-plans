import {ChevronDown, ChevronUp, X} from "lucide-react";
import type {KeyboardEvent, RefObject} from "react";

import {findCounterText, findMatches} from "../../lib/find-in-file";

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
	const groups: {block: Element; nodes: Text[]}[] = [];
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
			let index = nodes.length - 1;
			while (index > 0 && (starts[index] ?? 0) > offset - (isEnd ? 1 : 0)) index -= 1;
			return [nodes[index] as Text, offset - (starts[index] ?? 0)];
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

const BAR_BUTTON =
	"flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-r3 text-secondary hover:bg-fill-ghost-hover hover:text-primary disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent";

export function FindBar({
	inputRef,
	query,
	active,
	total,
	onQueryChange,
	onStep,
	onClose,
}: {
	inputRef: RefObject<HTMLInputElement | null>;
	query: string;
	active: number;
	total: number;
	onQueryChange: (query: string) => void;
	onStep: (direction: 1 | -1) => void;
	onClose: () => void;
}) {
	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Enter") {
			event.preventDefault();
			onStep(event.shiftKey ? -1 : 1);
		} else if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			onClose();
		}
	};
	return (
		// A zero-height sticky row keeps the bar in view whether the viewer or the page scrolls.
		<div className="sticky top-1 z-10 flex h-0 justify-end px-3">
			<div
				role="search"
				className="flex h-fit items-center gap-0.5 rounded-r5 border border-strong bg-surface-1 p-0.5 shadow-[var(--menu-shadow)]"
			>
				<input
					ref={inputRef}
					type="text"
					aria-label="Find in file"
					placeholder="Find in file…"
					spellCheck={false}
					autoComplete="off"
					value={query}
					onChange={(event) => onQueryChange(event.target.value)}
					onKeyDown={handleKeyDown}
					className="h-6 w-44 bg-transparent px-1.5 text-xs text-primary outline-none placeholder:text-t6"
				/>
				{query !== "" && (
					<span
						data-find-counter=""
						aria-live="polite"
						className="shrink-0 px-1 text-footnote whitespace-nowrap text-t6 tabular-nums"
					>
						{findCounterText(active, total)}
					</span>
				)}
				<button
					type="button"
					aria-label="Previous match"
					title="Previous match (⇧Enter)"
					disabled={total === 0}
					onClick={() => onStep(-1)}
					className={BAR_BUTTON}
				>
					<ChevronUp aria-hidden="true" className="size-4" />
				</button>
				<button
					type="button"
					aria-label="Next match"
					title="Next match (Enter)"
					disabled={total === 0}
					onClick={() => onStep(1)}
					className={BAR_BUTTON}
				>
					<ChevronDown aria-hidden="true" className="size-4" />
				</button>
				<button
					type="button"
					aria-label="Close find bar"
					title="Close find bar"
					onClick={onClose}
					className={BAR_BUTTON}
				>
					<X aria-hidden="true" className="size-4" />
				</button>
			</div>
		</div>
	);
}
