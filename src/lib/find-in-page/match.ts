/**
 * Upstream's page-find walker (shared-100 `Gh`): collects the DOM ranges a query matches under a root,
 * case-insensitive and diacritic-folded, never across block elements or newlines.
 */

/** Upstream `VN`: a subtree the find walker skips (unless it holds a `data-find-included` descendant). */
const FIND_OMITTED_ATTR = "data-find-omitted";
/** Upstream `Lh`: re-includes text inside an omitted subtree. */
const FIND_INCLUDED_ATTR = "data-find-included";
/** Upstream `lJ`: gutters are skipped behind a boundary. */
const GUTTER_ATTR = "data-gutter";
/** Upstream `u3`, `e8` (`fZ`) plus ruby annotations: skipped with no boundary. */
const SKIPPED_SELECTOR = '[data-cds="Avatar"], [data-cds="Icon"]:not(svg), rt, rp';

/** Upstream `Uw`: elements that start and end a text run, so matches never span them. */
const BLOCK_TAGS = new Set(
	"ADDRESS ARTICLE ASIDE BLOCKQUOTE BR DD DETAILS DIV DL DT FIGCAPTION FIGURE FOOTER H1 H2 H3 H4 H5 H6 HEADER HR LI MAIN NAV OL P PRE SECTION SUMMARY TABLE TBODY TD TFOOT TH THEAD TR UL".split(
		" ",
	),
);

const COMBINING_MARKS = /[̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯]/g;
const LETTER_FOLDS: Readonly<Record<string, string>> =
{
	đ: "d",
	ø: "o",
	ħ: "h",
	ŀ: "l",
	ł: "l",
	ſ: "s",
};
const LEFT_TO_RIGHT_MARK = "‎";

function foldCodePoint(char: string): string
{
	if (char === LEFT_TO_RIGHT_MARK) return "";
	let folded = "";
	for (const c of char.toLowerCase().normalize("NFD").replace(COMBINING_MARKS, "")) folded += LETTER_FOLDS[c] ?? c;
	return folded;
}

/** Fold text for matching, keeping each folded index's offset into the original (upstream `mj`). */
function foldWithOffsets(text: string):
{
	text: string;
	from: number[];
}
{
	let folded = "";
	const from: number[] = [];
	let offset = 0;
	for (const char of text)
	{
		const part = foldCodePoint(char);
		for (let i = 0; i < part.length; i++) from.push(offset);
		folded += part;
		offset += char.length;
	}
	from.push(offset);
	return {
		text: folded,
		from,
	};
}

/** Upstream `tB`: case-insensitive, diacritic-folded comparison text. */
export function foldFindText(text: string): string
{
	return foldWithOffsets(text).text;
}

/** Upstream `Jq`: non-overlapping match spans of `query` in `text`, as offsets into `text`. */
function* matchSpans(text: string, query: string): Generator<[number, number]>
{
	const needle = foldFindText(query);
	if (needle === "") return;
	const {text: haystack, from} = foldWithOffsets(text);
	for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + needle.length))
	{
		const start = from[at];
		const end = from[at + needle.length];
		if (start !== undefined && end !== undefined) yield [start, end];
	}
}

interface TextEntry
{
	readonly node: Text;
	readonly start: number;
}

function textEnd(entry: TextEntry | undefined): number
{
	return entry === undefined ? Number.POSITIVE_INFINITY : entry.start + entry.node.data.length;
}

export interface FindOptions
{
	/** Elements skipped behind a boundary, such as other providers' scopes. */
	readonly exclude?: ReadonlySet<Element>;
}

/**
 * Port of upstream `Gh`. `[data-find-omitted]` subtrees and gutters are skipped behind a `\0` boundary,
 * so a match can't run from the text before them into the text after. `aria-hidden` is not a walker
 * rule. Icons, avatars and ruby annotations are skipped with no boundary, so inline buttons and spans
 * keep text contiguous; only block tags, shadow roots and slots start a new run.
 */
export function collectFindRanges(root: Node, query: string, options: FindOptions = {}): Range[]
{
	if (query === "") return [];
	const document = root instanceof Document ? root : root.ownerDocument;
	if (!document) return [];
	const {exclude} = options;

	const texts: TextEntry[] = [];
	let joined = "";
	let pendingBoundary = false;

	const visitChildren = (node: Node, included: boolean): void =>
	{
		for (let child = node.firstChild; child; child = child.nextSibling) visit(child, included);
	};

	const visit = (node: Node, included: boolean): void =>
	{
		if (node instanceof Text)
		{
			if (!included) return;
			if (pendingBoundary)
			{
				joined += "\0";
				pendingBoundary = false;
			}
			texts.push(
				{
					node,
					start: joined.length,
				},
			);
			joined += node.data;
			return;
		}
		let next = included;
		if (node instanceof Element)
		{
			const element = node;
			if (exclude?.has(element) || element.hasAttribute(GUTTER_ATTR))
			{
				pendingBoundary = true;
				return;
			}
			if (element.hasAttribute(FIND_INCLUDED_ATTR)) next = true;
			else if (element.hasAttribute(FIND_OMITTED_ATTR))
			{
				if (!element.querySelector(`[${FIND_INCLUDED_ATTR}]`))
				{
					pendingBoundary = true;
					return;
				}
				next = false;
			}
			if (element.matches(SKIPPED_SELECTOR)) return;
			if (next !== included) pendingBoundary = true;
			if (element.shadowRoot)
			{
				pendingBoundary = true;
				visit(element.shadowRoot, next);
				pendingBoundary = true;
				return;
			}
			if (BLOCK_TAGS.has(element.tagName))
			{
				pendingBoundary = true;
				visitChildren(element, next);
				pendingBoundary = true;
				return;
			}
			if (element instanceof HTMLSlotElement)
			{
				const assigned = element.assignedNodes(
					{
						flatten: true,
					},
				);
				pendingBoundary = true;
				if (assigned.length > 0) for (const child of assigned) visit(child, next);
				else visitChildren(element, next);
				pendingBoundary = true;
				return;
			}
		}
		visitChildren(node, next);
		if (next !== included) pendingBoundary = true;
	};

	visit(root, true);

	const ranges: Range[] = [];
	let index = 0;
	let offset = 0;
	for (const segment of joined.split(/[\0\n]/))
	{
		for (const [start, end] of matchSpans(segment, query))
		{
			const from = offset + start;
			const to = offset + end;
			while (index < texts.length && textEnd(texts[index]) <= from) index++;
			const first = texts[index];
			if (first === undefined) break;
			const range = document.createRange();
			range.setStart(first.node, from - first.start);
			const last = texts.slice(index).find((entry) => to <= textEnd(entry));
			if (last !== undefined) range.setEnd(last.node, to - last.start);
			ranges.push(range);
		}
		offset += segment.length + 1;
	}
	return ranges;
}

/** Upstream `BT` over `tB`-folded text: non-overlapping occurrences of `query` in `text`. */
export function countOccurrences(text: string, query: string): number
{
	const needle = foldFindText(query);
	if (needle === "") return 0;
	const haystack = foldFindText(text);
	let count = 0;
	for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + needle.length)) count++;
	return count;
}

type LayoutState = "hidden" | "skipped" | "laid-out";

/** Per-search memo of computed styles, shared across every range one count checks (upstream's `{visible, subtree}`). */
export interface VisibilityCache
{
	readonly visible: Map<Element, boolean>;
	readonly subtree: Map<Element, LayoutState>;
}

export function newVisibilityCache(): VisibilityCache
{
	return {
		visible: new Map(),
		subtree: new Map(),
	};
}

/** Upstream `uG`: the parent element, crossing out of a shadow root to its host. */
function layoutParent(element: Element): Element | null
{
	if (element.parentElement) return element.parentElement;
	const root = element.getRootNode();
	return root instanceof ShadowRoot ? root.host : null;
}

/** Upstream `qJ`: the element a range starts in. */
function startElement(node: Node): Element | null
{
	if (node instanceof Element) return node;
	const parent = node.parentNode;
	return node.parentElement ?? (parent instanceof ShadowRoot ? parent.host : null);
}

/** Upstream `Ba`: whether an element is laid out, hidden by `display:none`, or skipped by `content-visibility:auto`. */
function layoutState(element: Element, cache: Map<Element, LayoutState> | undefined): LayoutState
{
	const cached = cache?.get(element);
	if (cached) return cached;
	const style = getComputedStyle(element);
	let state: LayoutState;
	if (style.display === "none") state = "hidden";
	else
	{
		const parent = layoutParent(element);
		const parentState = parent ? layoutState(parent, cache) : "laid-out";
		state =
			parentState === "hidden"
				? "hidden"
				: parentState === "skipped" || style.getPropertyValue("content-visibility") === "auto"
					? "skipped"
					: "laid-out";
	}
	cache?.set(element, state);
	return state;
}

/**
 * Upstream `N3`: a match counts when its element is `visibility:visible` and the range has a laid-out
 * height, or it sits under `content-visibility:auto`, where the browser skipped its layout.
 */
export function isRangeVisible(range: Range, cache?: VisibilityCache): boolean
{
	const element = startElement(range.startContainer);
	if (!element) return false;
	let visible = cache?.visible.get(element);
	if (visible === undefined)
	{
		visible = getComputedStyle(element).visibility === "visible";
		cache?.visible.set(element, visible);
	}
	if (!visible) return false;
	return range.getBoundingClientRect().height > 0 || layoutState(element, cache?.subtree) === "skipped";
}
