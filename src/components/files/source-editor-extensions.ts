import {codeFolding, foldGutter, foldService, getIndentUnit} from "@codemirror/language";
import
{
	countColumn,
	type EditorState,
	type Extension,
	RangeSetBuilder,
	StateEffect,
	StateField,
	type Text,
} from "@codemirror/state";
import {Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate} from "@codemirror/view";
import type {ThemedToken} from "@shikijs/core";

import {findMatches} from "../../lib/find-in-file";
import {shikiMarks} from "../../lib/shiki-cm-marks";

/** Upstream's code theme (`ͼ3w`, overridden by `ͼo`) and File editor decorations, in local tokens. */
export const sourceEditorThemeSpec =
{
	"&":
	{
		flex: "1 1 0%",
		minHeight: 0,
		height: "100%",
		backgroundColor: "var(--code-theme-bg, var(--color-surface-1))",
		color: "var(--code-theme-fg, var(--color-primary))",
	},
	"&.cm-focused":
	{
		outline: "none",
	},
	".cm-scroller":
	{
		fontFamily: "var(--font-mono)",
		lineHeight: "inherit",
		overflow: "auto",
	},
	".cm-content":
	{
		padding: "8px 0",
	},
	".cm-line":
	{
		padding: "0 12px 0 4px",
	},
	".cm-gutters":
	{
		backgroundColor: "inherit",
		color: "var(--muted-as-secondary)",
		border: "none",
	},
	".cm-gutters .cm-lineNumbers .cm-gutterElement":
	{
		padding: "0 10px 0 24px",
		minWidth: "2rem",
		cursor: "default",
		userSelect: "none",
	},
	// Upstream paints rgba(255,255,255,.05) on its dark theme; currentColor keeps light themes legible.
	".cm-activeLine":
	{
		backgroundColor: "color-mix(in srgb, currentColor 5%, transparent)",
	},
	".cm-activeLineGutter":
	{
		backgroundColor: "transparent",
		color: "inherit",
	},
	".cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground":
	{
		background: "rgba(0,153,255,.3)",
	},
	".cm-selectionMatch":
	{
		backgroundColor: "rgba(0,153,255,.14)",
	},
	":where(.cm-shikiItalic)":
	{
		fontStyle: "italic",
	},
	":where(.cm-shikiBold)":
	{
		fontWeight: "bold",
		fontVariationSettings: "normal",
	},
	":where(.cm-shikiUnderline)":
	{
		textDecoration: "underline",
	},
	":where(.cm-shikiStrikethrough)":
	{
		textDecoration: "line-through",
	},
	":where(.cm-shikiUnderline.cm-shikiStrikethrough)":
	{
		textDecoration: "underline line-through",
	},
	".cm-epitaxyJumpRange":
	{
		backgroundColor: "color-mix(in srgb, currentColor 8%, transparent)",
	},
	".cm-foldGutter .cm-gutterElement":
	{
		width: "12px",
		display: "flex",
		alignItems: "flex-start",
		justifyContent: "center",
		padding: 0,
	},
	".cm-foldGutter span":
	{
		display: "flex",
		alignItems: "center",
		height: "1lh",
		padding: 0,
		cursor: "pointer",
	},
	".cm-fold-open svg":
	{
		transform: "rotate(90deg)",
	},
	"@media (hover: hover) and (pointer: fine)":
	{
		".cm-fold-open":
		{
			opacity: 0,
			transition: "opacity var(--cds-dur-base, 150ms) ease-out",
		},
		".cm-gutters:hover .cm-fold-open":
		{
			opacity: 1,
		},
	},
	"&.cm-focused .cm-activeLineGutter .cm-fold-open":
	{
		opacity: 1,
	},
	"@media (prefers-reduced-motion: reduce)":
	{
		".cm-fold-open":
		{
			transition: "none",
		},
	},
	"[data-reduce-motion=true] & .cm-fold-open":
	{
		transition: "none",
	},
	".cm-foldPlaceholder":
	{
		background: "transparent",
		border: "none",
		color: "var(--muted-as-secondary)",
		padding: "0 var(--cds-pad-xs, 4px)",
		cursor: "pointer",
	},
	".cm-epitaxyFindMatch:not(.cm-epitaxyFindMatch-active)":
	{
		backgroundColor: "rgba(255,213,0,.18)",
		borderRadius: "2px",
	},
	".cm-epitaxyFindMatch-active":
	{
		backgroundColor: "rgba(255,213,0,.55)",
		borderRadius: "2px",
		color: "#000",
		outline: "1px solid color-mix(in srgb, currentColor 60%, transparent)",
		outlineOffset: "-1px",
	},
	".cm-line .cm-epitaxyFindMatch-active span":
	{
		color: "#000",
	},
	".cm-epitaxyBracketPair0, .cm-epitaxyBracketPair0 span":
	{
		color: "rgb(255,208,20)",
	},
	".cm-epitaxyBracketPair1, .cm-epitaxyBracketPair1 span":
	{
		color: "rgb(243,192,211)",
	},
	".cm-epitaxyBracketPair2, .cm-epitaxyBracketPair2 span":
	{
		color: "rgb(59,189,140)",
	},
	"&.cm-focused .cm-matchingBracket":
	{
		backgroundColor: "rgba(0,153,255,.14)",
		outline: "1px solid color-mix(in srgb, currentColor 45%, transparent)",
		outlineOffset: "-1px",
	},
	".cm-highlightSpace":
	{
		backgroundImage:
			"radial-gradient(circle, color-mix(in srgb, currentColor 25%, transparent 75%) 1px, transparent 1.25px)",
	},
	// A data-URI svg can't read currentColor, so the tab arrow keeps CodeMirror's stroke.
	".cm-highlightTab":
	{
		backgroundPosition: "left center",
	},
} satisfies Parameters<typeof EditorView.theme>[0];

export const sourceEditorTheme = EditorView.theme(sourceEditorThemeSpec);

/* ---------- Shiki syntax colors ---------- */

const setShikiMarks = StateEffect.define<DecorationSet>();

const shikiField = StateField.define<DecorationSet>(
	{
		create: () => Decoration.none,
		update: (marks, tr) =>
		{
			for (const effect of tr.effects)
			{
				if (effect.is(setShikiMarks)) return effect.value;
			}
			return tr.docChanged ? marks.map(tr.changes) : marks;
		},
		provide: (field) => EditorView.decorations.from(field),
	},
);

/** The Shiki marks for `tokens` over `doc`, dropped when the tokens don't fit the document. */
export function shikiUpdate(
	doc: Text,
	tokens: readonly (readonly ThemedToken[])[] | null | undefined,
):
{
	effect: StateEffect<DecorationSet>;
	palette: string[];
}
{
	if (!tokens || tokens.length > doc.lines)
	{
		return {
			effect: setShikiMarks.of(Decoration.none),
			palette: [],
		};
	}
	const lineStarts = tokens.map((_, index) => doc.line(index + 1).from);
	const {decorations, palette} = shikiMarks(tokens, lineStarts);
	const builder = new RangeSetBuilder<Decoration>();
	for (const mark of decorations)
	{
		if (mark.to <= doc.length)
			builder.add(
				mark.from,
				mark.to,
				Decoration.mark(
					{
						class: mark.class,
					},
				),
			);
	}
	return {
		effect: setShikiMarks.of(builder.finish()),
		palette,
	};
}

/** Upstream's per-theme `:where(.cm-shikiColorN)` rules. */
export function shikiPaletteTheme(palette: readonly string[]): Extension
{
	if (palette.length === 0) return [];
	return EditorView.theme(
		Object.fromEntries(
			palette.map((color, index) => [
				`:where(.cm-shikiColor${index + 1})`,
				{
					color,
				},
			]),
		),
	);
}

export const shikiExtension: Extension = shikiField;

/* ---------- Jump range (deep-linked lines) ---------- */

export interface LineRange
{
	line: number;
	endLine: number;
}

export const setJumpRange = StateEffect.define<LineRange | null>();

const jumpLine = Decoration.line(
	{
		class: "cm-epitaxyJumpRange",
	},
);

const jumpField = StateField.define<DecorationSet>(
	{
		create: () => Decoration.none,
		update: (ranges, tr) =>
		{
			for (const effect of tr.effects)
			{
				if (!effect.is(setJumpRange)) continue;
				if (effect.value === null) return Decoration.none;
				const {doc} = tr.state;
				const builder = new RangeSetBuilder<Decoration>();
				const last = Math.min(effect.value.endLine, doc.lines);
				for (let number = effect.value.line; number <= last; number += 1)
				{
					const from = doc.line(number).from;
					builder.add(from, from, jumpLine);
				}
				return builder.finish();
			}
			return tr.docChanged ? ranges.map(tr.changes) : ranges;
		},
		provide: (field) => EditorView.decorations.from(field),
	},
);

export const jumpRangeExtension: Extension = jumpField;

/* ---------- Find in file ---------- */

export interface FindHighlight
{
	query: string;
	/** Zero-based index of the active match, counted line by line like `lineMatchOffsets`. */
	active: number;
	/** Changes whenever the active match should scroll into view. */
	nonce: number;
}

/** Every match of `query` in `doc`, matched per line so the order agrees with `lineMatchOffsets`. */
export function findRanges(
	doc: Text,
	query: string,
):
{
	from: number;
	to: number;
}[]
{
	if (query === "") return [];
	const ranges:
	{
		from: number;
		to: number;
	}[] = [];
	for (let number = 1; number <= doc.lines; number += 1)
	{
		const line = doc.line(number);
		for (const match of findMatches(line.text, query))
		{
			ranges.push(
				{
					from: line.from + match.start,
					to: line.from + match.end,
				},
			);
		}
	}
	return ranges;
}

const findMark = Decoration.mark(
	{
		class: "cm-epitaxyFindMatch",
	},
);
const activeFindMark = Decoration.mark(
	{
		class: "cm-epitaxyFindMatch cm-epitaxyFindMatch-active",
	},
);

export const setFindHighlight = StateEffect.define<FindHighlight | null>();

function findDecorations(state: EditorState, highlight: FindHighlight | null): DecorationSet
{
	if (highlight === null) return Decoration.none;
	const builder = new RangeSetBuilder<Decoration>();
	findRanges(state.doc, highlight.query).forEach((range, index) =>
	{
		builder.add(range.from, range.to, index === highlight.active ? activeFindMark : findMark);
	});
	return builder.finish();
}

const findField = StateField.define<
{
	highlight: FindHighlight | null;
	decorations: DecorationSet;
}>(
	{
		create: () => (
		{
			highlight: null,
			decorations: Decoration.none,
		}),
		update: (value, tr) =>
		{
			let highlight = value.highlight;
			let changed = tr.docChanged;
			for (const effect of tr.effects)
			{
				if (effect.is(setFindHighlight))
				{
					highlight = effect.value;
					changed = true;
				}
			}
			return changed
				?
					{
						highlight,
						decorations: findDecorations(tr.state, highlight),
					}
				: value;
		},
		provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
	},
);

export const findExtension: Extension = findField;

/* ---------- Folding ---------- */

function headingLevel(text: string): number
{
	return /^(#{1,6})(?:\s|$)/.exec(text)?.[1]?.length ?? 0;
}

/** A markdown heading folds to the line before the next heading of its level or higher. */
const markdownFolds = foldService.of((state, lineStart) =>
{
	const {doc} = state;
	const line = doc.lineAt(lineStart);
	const level = headingLevel(line.text);
	if (level === 0) return null;
	let last = line.number;
	for (let number = line.number + 1; number <= doc.lines; number += 1)
	{
		const text = doc.line(number).text;
		const nextLevel = headingLevel(text);
		if (nextLevel > 0 && nextLevel <= level) break;
		if (text.trim() !== "") last = number;
	}
	return last === line.number
		? null
		:
			{
				from: line.to,
				to: doc.line(last).to,
			};
});

function indentOf(text: string, tabSize: number): number
{
	return countColumn(/^\s*/.exec(text)?.[0] ?? "", tabSize);
}

/** A line folds over the following lines indented deeper than it, ignoring blank lines. */
const indentFolds = foldService.of((state, lineStart) =>
{
	const {doc} = state;
	const line = doc.lineAt(lineStart);
	if (line.text.trim() === "") return null;
	const indent = indentOf(line.text, state.tabSize);
	let last = line.number;
	for (let number = line.number + 1; number <= doc.lines; number += 1)
	{
		const text = doc.line(number).text;
		if (text.trim() === "") continue;
		if (indentOf(text, state.tabSize) <= indent) break;
		last = number;
	}
	return last === line.number
		? null
		:
			{
				from: line.to,
				to: doc.line(last).to,
			};
});

const SVG_NS = "http://www.w3.org/2000/svg";

/** Upstream's 12px fold chevron, rotated 90° while the range is open. */
function foldMarker(open: boolean): HTMLElement
{
	const marker = document.createElement("span");
	marker.className = open ? "cm-fold-open" : "cm-fold-closed";
	marker.title = open ? "Fold line" : "Unfold line";
	const svg = document.createElementNS(SVG_NS, "svg");
	for (const [name, value] of Object.entries(
		{
			viewBox: "0 0 16 16",
			width: "12px",
			height: "12",
			fill: "none",
			stroke: "currentColor",
			"stroke-width": "1.33",
			"stroke-linecap": "round",
			"stroke-linejoin": "round",
			"aria-hidden": "true",
		},
	))
	{
		svg.setAttribute(name, value);
	}
	const path = document.createElementNS(SVG_NS, "path");
	path.setAttribute("d", "M6 4L10 8L6 12");
	svg.append(path);
	marker.append(svg);
	return marker;
}

function foldPlaceholder(_view: EditorView, onclick: (event: Event) => void): HTMLElement
{
	const placeholder = document.createElement("span");
	placeholder.className = "cm-foldPlaceholder";
	placeholder.setAttribute("aria-label", "Folded code");
	placeholder.title = "Unfold";
	placeholder.contentEditable = "false";
	placeholder.textContent = "…";
	placeholder.addEventListener("click", onclick);
	return placeholder;
}

/** The fold gutter and placeholder, folding markdown by heading and code by indentation. */
export function foldingExtension(language: string | null | undefined): Extension
{
	return [
		language === "markdown" ? markdownFolds : indentFolds,
		codeFolding(
			{
				placeholderDOM: foldPlaceholder,
			},
		),
		foldGutter(
			{
				markerDOM: foldMarker,
			},
		),
	];
}

/* ---------- Bracket pair colors ---------- */

const OPENERS: Record<string, string> =
{
	"(": ")",
	"[": "]",
	"{": "}",
};
const CLOSERS = new Set(Object.values(OPENERS));

const bracketMarks = [0, 1, 2].map((depth) =>
	Decoration.mark(
		{
			class: `cm-epitaxyBracketPair${depth}`,
		},
	),
);

/** Upstream's bracket pair colorizer: depth % 3 colors over the viewport, scanning from the top for depth. */
function bracketDecorations(view: EditorView): DecorationSet
{
	const {from: viewFrom, to: viewTo} = view.viewport;
	const builder = new RangeSetBuilder<Decoration>();
	const stack:
	{
		closer: string;
		depth: number;
	}[] = [];
	let position = 0;
	for (const iterator = view.state.doc.iterRange(0, viewTo); !iterator.next().done;)
	{
		const text = iterator.value;
		if (!iterator.lineBreak)
		{
			for (let index = 0; index < text.length; index += 1)
			{
				const char = text.charAt(index);
				const closer = OPENERS[char];
				let depth: number | null = null;
				if (closer !== undefined)
				{
					depth = stack.length;
					stack.push(
						{
							closer,
							depth,
						},
					);
				}
				else if (CLOSERS.has(char) && stack.at(-1)?.closer === char)
				{
					depth = stack.pop()?.depth ?? null;
				}
				const mark = depth === null ? undefined : bracketMarks[depth % 3];
				const at = position + index;
				if (mark !== undefined && at >= viewFrom) builder.add(at, at + 1, mark);
			}
		}
		position += text.length;
	}
	return builder.finish();
}

export const bracketPairColors = ViewPlugin.fromClass(
	class
	{
		decorations: DecorationSet;

		constructor(view: EditorView)
		{
			this.decorations = bracketDecorations(view);
		}

		update(update: ViewUpdate)
		{
			if (update.docChanged || update.viewportChanged) this.decorations = bracketDecorations(update.view);
		}
	},
	{
		decorations: (plugin) => plugin.decorations,
	},
);

/* ---------- Indent guides ---------- */

/** Upstream's `q`: no indent, for blank lines and lines past the document. */
const NO_INDENT = -1;
/** Only this many leading characters are scanned for indentation. */
const MAX_INDENT_SCAN = 1000;
/** How far a blank line looks up and down for a non-blank neighbour. */
const MAX_BLANK_SEARCH = 100;
/** Levels are computed and cached in chunks of this many lines. */
const LEVEL_CHUNK = 200;
/** Lines deeper than this keep the plain guides even inside the active block. */
const MAX_ACTIVE_LEVEL = 64;
const GUIDE_COLOR = "var(--epitaxy-indent-guide, color-mix(in srgb, currentColor 14%, transparent))";
const ACTIVE_GUIDE_COLOR = "var(--epitaxy-indent-guide-active, color-mix(in srgb, currentColor 40%, transparent))";

interface IndentedLine
{
	number: number;
	columns: number;
}

/** The leading indentation in columns, or NO_INDENT for a blank or whitespace-only line. */
function leadingColumns(text: string, tabSize: number): number
{
	let columns = 0;
	const end = Math.min(text.length, MAX_INDENT_SCAN);
	for (let index = 0; index < end; index += 1)
	{
		const code = text.charCodeAt(index);
		if (code === 32) columns += 1;
		else if (code === 9) columns += tabSize - (columns % tabSize);
		else return columns;
	}
	return NO_INDENT;
}

/** The nearest non-blank line from `start` in `direction`, or the last line looked at with NO_INDENT. */
function nearestIndented(doc: Text, start: number, direction: 1 | -1, tabSize: number): IndentedLine
{
	let number = start;
	for (let step = 1; step <= MAX_BLANK_SEARCH; step += 1)
	{
		const candidate = start + direction * step;
		if (candidate < 1 || candidate > doc.lines) break;
		number = candidate;
		const columns = leadingColumns(doc.line(candidate).text, tabSize);
		if (columns !== NO_INDENT)
			return {
				number,
				columns,
			};
	}
	return {
		number,
		columns: NO_INDENT,
	};
}

/** Guide levels for lines `first..last`; blank lines borrow from the non-blank lines around them. */
function chunkLevels(doc: Text, first: number, last: number, tabSize: number, unit: number): number[]
{
	const levels: number[] = [];
	let above = nearestIndented(doc, first, -1, tabSize);
	let below: IndentedLine | null = null;
	for (let number = first; number <= last; number += 1)
	{
		const columns = leadingColumns(doc.line(number).text, tabSize);
		if (columns !== NO_INDENT)
		{
			above =
			{
				number,
				columns,
			};
			below = null;
			levels.push(Math.ceil(columns / unit));
			continue;
		}
		below ??=
			above.columns === NO_INDENT
				?
					{
						number: 0,
						columns: NO_INDENT,
					}
				: nearestIndented(doc, above.number, 1, tabSize);
		if (below.columns === NO_INDENT) levels.push(0);
		else if (above.columns === below.columns) levels.push(Math.ceil(above.columns / unit));
		else levels.push(1 + Math.floor(Math.min(above.columns, below.columns) / unit));
	}
	return levels;
}

type LevelOf = (line: number) => number;

/** A lazy, chunk-cached line number to guide level lookup for `state`. */
function levelLookup(state: EditorState): LevelOf
{
	const {doc, tabSize} = state;
	const unit = getIndentUnit(state);
	const chunks = new Map<number, number[]>();
	return (line) =>
	{
		if (line < 1 || line > doc.lines) return NO_INDENT;
		const start = line - ((line - 1) % LEVEL_CHUNK);
		let levels = chunks.get(start);
		if (!levels)
		{
			levels = chunkLevels(doc, start, Math.min(doc.lines, start + LEVEL_CHUNK - 1), tabSize, unit);
			chunks.set(start, levels);
		}
		return levels[line - start] ?? NO_INDENT;
	};
}

interface ActiveBlock
{
	first: number;
	last: number;
	level: number;
}

/**
 * The block whose guide holds the caret: the caret line's level, one deeper when the caret sits
 * on a block opener or closer, extended through neighbouring lines at least that deep.
 */
function activeBlock(
	levelOf: LevelOf,
	caret: number,
	top: number,
	bottom: number,
	previous: ActiveBlock | null,
): ActiveBlock | null
{
	let level = levelOf(caret);
	let anchor = caret;
	if (levelOf(caret + 1) === level + 1)
	{
		level += 1;
		anchor = caret + 1;
	}
	else if (levelOf(caret - 1) === level + 1)
	{
		level += 1;
		anchor = caret - 1;
	}
	if (level <= 0) return null;
	const reuse = previous?.level === level && anchor >= previous.first && anchor <= previous.last;
	let first = reuse ? previous.first : anchor;
	let last = reuse ? previous.last : anchor;
	while (first > top && levelOf(first - 1) >= level) first -= 1;
	while (last < bottom && levelOf(last + 1) >= level) last += 1;
	return {
		first,
		last,
		level,
	};
}

function caretLine(state: EditorState): number
{
	return state.doc.lineAt(state.selection.main.head).number;
}

function viewActiveBlock(view: EditorView, levelOf: LevelOf, previous: ActiveBlock | null): ActiveBlock | null
{
	const {doc} = view.state;
	return activeBlock(
		levelOf,
		caretLine(view.state),
		doc.lineAt(view.viewport.from).number,
		doc.lineAt(view.viewport.to).number,
		previous,
	);
}

/** One 1px stop per level, with the active level's guide in the active color. */
function activeGuidesImage(level: number, activeLevel: number, unit: number): string
{
	const stops: string[] = [];
	for (let index = 0; index < level; index += 1)
	{
		const color = index === activeLevel - 1 ? ACTIVE_GUIDE_COLOR : GUIDE_COLOR;
		const start = `${index * unit}ch`;
		const end = `calc(${start} + 1px)`;
		stops.push(`transparent ${start}`, `${color} ${start} ${end}`, `transparent ${end}`);
	}
	return `linear-gradient(to right,${stops.join(",")})`;
}

function guideDecorations(view: EditorView, levelOf: LevelOf, active: ActiveBlock | null): DecorationSet
{
	const {doc} = view.state;
	const unit = getIndentUnit(view.state);
	const builder = new RangeSetBuilder<Decoration>();
	const plain = new Map<number, Decoration>();
	const highlighted = new Map<number, Decoration>();
	for (const {from, to} of view.visibleRanges)
	{
		const last = doc.lineAt(to).number;
		for (let number = doc.lineAt(from).number; number <= last; number += 1)
		{
			const level = levelOf(number);
			if (level <= 0) continue;
			let decoration = plain.get(level);
			if (!decoration)
			{
				decoration = Decoration.line(
					{
						class: "cm-epitaxyIndentGuides",
						attributes:
						{
							style: `--epitaxy-indent-unit:${unit}ch;--epitaxy-indent-guides-width:${(level - 1) * unit + 1}ch`,
						},
					},
				);
				plain.set(level, decoration);
			}
			if (active && number >= active.first && number <= active.last && level <= MAX_ACTIVE_LEVEL)
			{
				let activeDecoration = highlighted.get(level);
				if (!activeDecoration)
				{
					activeDecoration = Decoration.line(
						{
							class: "cm-epitaxyIndentGuides",
							attributes:
							{
								style: `--epitaxy-indent-guides-width:${(level - 1) * unit + 1}ch;background-image:${activeGuidesImage(level, active.level, unit)}`,
							},
						},
					);
					highlighted.set(level, activeDecoration);
				}
				decoration = activeDecoration;
			}
			const {from: lineStart} = doc.line(number);
			builder.add(lineStart, lineStart, decoration);
		}
	}
	return builder.finish();
}

const indentGuidesPlugin = ViewPlugin.fromClass(
	class
	{
		levelOf: LevelOf;
		active: ActiveBlock | null;
		decorations: DecorationSet;

		constructor(view: EditorView)
		{
			this.levelOf = levelLookup(view.state);
			this.active = viewActiveBlock(view, this.levelOf, null);
			this.decorations = guideDecorations(view, this.levelOf, this.active);
		}

		update(update: ViewUpdate)
		{
			const relevel =
				update.docChanged ||
				update.startState.tabSize !== update.state.tabSize ||
				getIndentUnit(update.startState) !== getIndentUnit(update.state);
			if (relevel) this.levelOf = levelLookup(update.state);
			const previous = this.active;
			if (relevel || update.viewportChanged || caretLine(update.startState) !== caretLine(update.state))
				this.active = viewActiveBlock(update.view, this.levelOf, relevel ? null : previous);
			if (
				relevel ||
				update.viewportChanged ||
				this.active?.level !== previous?.level ||
				this.active?.first !== previous?.first ||
				this.active?.last !== previous?.last
			)
				this.decorations = guideDecorations(update.view, this.levelOf, this.active);
		}
	},
	{
		decorations: (plugin) => plugin.decorations,
	},
);

const indentGuidesTheme = EditorView.baseTheme(
	{
		".cm-epitaxyIndentGuides":
		{
			backgroundImage: `repeating-linear-gradient(to right, ${GUIDE_COLOR} 0 1px, transparent 1px var(--epitaxy-indent-unit))`,
			backgroundSize: "var(--epitaxy-indent-guides-width) 100%",
			backgroundRepeat: "no-repeat",
			backgroundOrigin: "content-box",
		},
		"@supports (height: 1lh)":
		{
			".cm-epitaxyIndentGuides":
			{
				backgroundSize: "var(--epitaxy-indent-guides-width) 1lh",
			},
		},
	},
);

/** Upstream's indent guides (`oa()`, chunk cbd02b8f2): 1px guides per indent level, the caret's block at 40%. */
export function indentGuides(): Extension
{
	return [indentGuidesPlugin, indentGuidesTheme];
}

/** A line's hanging indent in columns; a whitespace run past the scan limit still indents fully. */
function hangingColumns(text: string, tabSize: number): number
{
	const columns = leadingColumns(text, tabSize);
	if (columns !== NO_INDENT || text.length <= MAX_INDENT_SCAN) return columns;
	return text.trim() === "" ? NO_INDENT : MAX_INDENT_SCAN;
}

function hangingIndentDecorations(view: EditorView): DecorationSet
{
	const {doc, tabSize} = view.state;
	const builder = new RangeSetBuilder<Decoration>();
	const byColumns = new Map<number, Decoration>();
	for (const {from, to} of view.visibleRanges)
	{
		const last = doc.lineAt(to).number;
		for (let number = doc.lineAt(from).number; number <= last; number += 1)
		{
			const line = doc.line(number);
			const columns = hangingColumns(line.text, tabSize);
			if (columns <= 0) continue;
			let decoration = byColumns.get(columns);
			if (!decoration)
			{
				decoration = Decoration.line(
					{
						class: "cm-epitaxyHangingIndent",
						attributes:
						{
							style: `--epitaxy-hanging-indent:${columns}`,
						},
					},
				);
				byColumns.set(columns, decoration);
			}
			builder.add(line.from, line.from, decoration);
		}
	}
	return builder.finish();
}

const hangingIndentPlugin = ViewPlugin.fromClass(
	class
	{
		decorations: DecorationSet;

		constructor(view: EditorView)
		{
			this.decorations = hangingIndentDecorations(view);
		}

		update(update: ViewUpdate)
		{
			if (update.docChanged || update.viewportChanged || update.startState.tabSize !== update.state.tabSize)
				this.decorations = hangingIndentDecorations(update.view);
		}
	},
	{
		decorations: (plugin) => plugin.decorations,
	},
);

/** The 4px and 12px are `.cm-line`'s start and end padding in `sourceEditorTheme`. */
const hangingIndentTheme = EditorView.baseTheme(
	{
		".cm-epitaxyHangingIndentContainer":
		{
			containerType: "inline-size",
		},
		".cm-epitaxyHangingIndent":
		{
			textIndent: "min((100cqi - 4px - 12px) / 2, var(--epitaxy-hanging-indent) * 1ch) hanging",
		},
		".cm-epitaxyHangingIndent.cm-epitaxyIndentGuides":
		{
			backgroundSize:
				"var(--epitaxy-indent-guides-width) max(1lh, min(100%, ((100cqi - 16px) / 2 - var(--epitaxy-indent-guides-width)) * 999))",
		},
	},
);

/**
 * Upstream's wrapped-line hanging indent (`fa()`, chunk cbd02b8f2): continuation rows start under
 * the line's indent, capped at half the text width.
 */
export function hangingIndent(): Extension
{
	return [
		hangingIndentPlugin,
		EditorView.contentAttributes.of(
			{
				class: "cm-epitaxyHangingIndentContainer",
			},
		),
		hangingIndentTheme,
	];
}
