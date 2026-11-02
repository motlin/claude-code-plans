import {INVISIBLE_BASE, PEM_BEGIN, findSecrets} from "./secret-mask";

/*
 * Upstream's audit of a drawn mermaid diagram (c9e4d0c57 `ge`, with `I`, `pe`, `R`, `z`, `B`, `he`, `U` and `W`;
 * crawl 2026-11-10, dumps/mermaid-fence-secret-fallback-c9e4d0c57.js.txt for the older aliases). The fence shows its
 * code block instead of a drawing whose text holds a secret, even one split across labels, tspans or lines, or whose
 * styles could change how its glyphs read. Upstream minified names are given in comments for cross-reference.
 */

/** v: the elements whose text is a label. */
const LABEL_TAGS = new Set(["text", "title", "desc", "foreignobject"]);
/** se: CSS that changes glyphs, their order or their spacing, a CSS escape, or a comment. */
const GLYPH_CSS =
	/(?:^|[^-\w])(?:-[a-z]+-)?(?:(?:text-transform|unicode-bidi|writing-mode|text-orientation|text-combine(?:-upright)?|rtl-ordering|direction|content|font-variant(?:-caps)?|font-feature-settings)\s*:|font\s*:[^;:}]*(?:caps|unicase|\()|(?:word|letter)-spacing\s*:[^;}]*[-(])|\\|\/\*/i;
/** ce */
const GLYPH_ATTRIBUTES = ["direction", "unicode-bidi", "writing-mode", "font-variant"];
/** y */
const SPACING_ATTRIBUTES = ["word-spacing", "letter-spacing"];
/** b */
const NODE_JOIN = "​";
/** le */
const BIDI_CONTROL = /[؜‎‏‪-‮⁦-⁩]/;
/** x = L6 (shared-l-p-m-w-0): the replacement character and the control pictures. */
const STAND_IN_GLYPH = /[�␀-␡]/;
/** S */
const WORD_CHAR = /[A-Za-z0-9_-]/;
/** C */
const NON_ASCII = /[^\t\n\r\x20-\x7E]/;
/** w */
const SEPARATOR = /[\t\n\r \x21-\x2C\x2E\x2F\x3A-\x40\x5B-\x5E\x60\x7B-\x7E]/;
/** ue */
const WORD_RUNS = /[^\t\n\r \x21-\x2C\x2E\x2F\x3A-\x40\x5B-\x5E\x60\x7B-\x7E]+/g;
/** T: pads a probe so a secret pattern can run past the real text. */
const PAD = "7".repeat(64);
/** E */
const TAIL_WORD_CHARS = 16;
/** D */
const HEAD_WORD_CHARS = 96;
/** O */
const MAX_RUN = 512;
/** k */
const MAX_PAIRS = 100_000;
/** A */
const MAX_RUN_PIECES = 32;
/** de */
const DOT_PROBE_COST = 4;
/** j */
const WORK_BUDGET = 15_000_000;
/** fe */
const MARKED = new RegExp(String.raw`${INVISIBLE_BASE.source}|[\p{M}\p{C}]`, "u");
/** M */
const MARKED_COST = 30;
/** N */
const JOIN_PAIR_COST = 16;
/** P */
const JOIN_LENGTH_DIVISOR = 4;
/** The longest text upstream reads (`262144` in `R` and `ge`). */
const MAX_READ = 262_144;
const NON_ASCII_ALL = /[^\t\n\r\x20-\x7E]/g;

interface Collected
{
	svg: boolean;
	altersGlyphs: boolean;
	nodes: string[];
	pieces: string[];
	lines: string[];
	linesButLast: string[];
	linesButFirst: string[];
	runs: string[];
	runsTooLong: boolean;
}

/** F: a separator other than a dot. Callers only pass chars inside the text. */
function isBreak(char: string | undefined): boolean
{
	return char !== undefined && char !== "." && SEPARATOR.test(char);
}

/** me. Callers only pass chars inside the text. */
function isWordChar(char: string | undefined): boolean
{
	return char !== undefined && WORD_CHAR.test(char);
}

/** Upstream's `w.test(char)`. Callers only pass chars inside the text. */
function isSeparator(char: string | undefined): boolean
{
	return char !== undefined && SEPARATOR.test(char);
}

/** F tested over a whole line; every separator is ASCII, so code points and code units agree. */
const BREAK = /[\t\n\r \x21-\x2C\x2F\x3A-\x40\x5B-\x5E\x60\x7B-\x7E]/;

function isElement(node: Node): node is Element
{
	return node.nodeType === Node.ELEMENT_NODE;
}

/**
 * pe: every run of consecutive lines a secret could span (lines with no break char join their neighbours), or null
 * when more than {@link MAX_RUN_PIECES} unbroken lines follow one another.
 */
function joinedRuns(lines: string[]): string[] | null
{
	const breaks = lines.map((line) => BREAK.test(line));
	let unbroken = 0;
	for (const broken of breaks)
	{
		unbroken = broken ? 0 : unbroken + 1;
		if (unbroken > MAX_RUN_PIECES) return null;
	}
	const runs: string[] = [];
	for (const [first, line] of lines.entries())
	{
		let run = line;
		for (let next = first + 1; next < lines.length && !(next - 1 > first && breaks[next - 1] === true); next++)
		{
			run += lines[next] ?? "";
			runs.push(run);
		}
	}
	return runs;
}

/** I: walks the tree, shadow roots included, gathering label text and whether any style bends glyphs. */
function collect(parent: Node, into: Collected, insideLabel: boolean): void
{
	for (const child of parent.childNodes)
	{
		if (child.nodeType === Node.TEXT_NODE)
		{
			into.nodes.push(child.nodeValue ?? "");
			continue;
		}
		if (!isElement(child)) continue;
		const element = child;
		const tag = element.localName.toLowerCase();
		if (tag === "script") continue;
		if (tag === "style")
		{
			into.altersGlyphs ||= GLYPH_CSS.test(element.textContent);
			continue;
		}
		into.svg ||= tag === "svg";
		into.altersGlyphs ||=
			GLYPH_CSS.test(element.getAttribute("style") ?? "") ||
			GLYPH_ATTRIBUTES.some((name) => element.hasAttribute(name)) ||
			SPACING_ATTRIBUTES.some((name) => /[-(]/.test(element.getAttribute(name) ?? ""));
		const label = !insideLabel && LABEL_TAGS.has(tag);
		if (label)
		{
			into.pieces.push(element.textContent);
			const lines = Array.from(element.childNodes, (node) => node.textContent ?? "");
			into.lines.push(...lines);
			into.linesButLast.push(...lines.slice(0, -1));
			into.linesButFirst.push(...lines.slice(1));
			const runs = joinedRuns(lines);
			into.runs.push(...(runs ?? []));
			into.runsTooLong ||= runs === null;
		}
		collect(element, into, insideLabel || label);
		if (element.shadowRoot) collect(element.shadowRoot, into, insideLabel || label);
	}
}

/** L: the work spent on probes in the current audit. */
let work = 0;

/** R: the secrets in `text`, charged to the work budget; over budget, or over upstream's read limit, it throws. */
function probe(text: string): ReturnType<typeof findSecrets>
{
	work += text.length * (MARKED.test(text) ? MARKED_COST : 1);
	if (work > WORK_BUDGET || text.length > MAX_READ) throw new Error("more than is read");
	return findSecrets(text);
}

/** z: whether some token in `run` is the start of a secret, found by padding each token prefix and probing it. */
function startsSecret(run: string): boolean
{
	for (let start = 0; start < run.length; start++)
	{
		if (!isWordChar(run[start]) || (start > 0 && isWordChar(run[start - 1]))) continue;
		let count = 0;
		for (let end = start; end < run.length && count < TAIL_WORD_CHARS; end++)
		{
			if (!isWordChar(run[end])) continue;
			count++;
			const prefix = run.slice(start, end + 1);
			if (probe(prefix + PAD).some((match) => match.end > prefix.length)) return true;
		}
	}
	return false;
}

/** B: whether some piece's tail joined to some piece's head makes a secret that crosses the seam. */
function seamSecret(pieces: Set<string>): boolean
{
	const tails = new Set<string>();
	const heads = new Set<string>();
	for (const piece of pieces)
	{
		let last = piece.length - 1;
		while (last >= 0 && !isWordChar(piece[last])) last--;
		let tailStart = -1;
		let words = 0;
		for (let at = last; at >= 0 && last - at < MAX_RUN && !isSeparator(piece[at]); at--)
			if (isWordChar(piece[at]))
			{
				words++;
				if (words >= TAIL_WORD_CHARS) break;
				if (at === 0 || !isWordChar(piece[at - 1])) tailStart = at;
			}
		if (tailStart >= 0) tails.add(piece.slice(tailStart, last + 1));
		let first = 0;
		while (first < piece.length && !isWordChar(piece[first])) first++;
		let end = first;
		for (
			let headWords = 0;
			end < piece.length && headWords < HEAD_WORD_CHARS && end - first < MAX_RUN && !isSeparator(piece[end]);
			end++
		)
			headWords += isWordChar(piece[end]) ? 1 : 0;
		if (end > first) heads.add(piece.slice(first, end));
	}
	if (tails.size * heads.size > MAX_PAIRS) return true;
	for (const tail of tails)
		for (const head of heads)
			if (probe(tail + head + PAD).some((match) => match.start < tail.length && match.end > tail.length))
				return true;
	return false;
}

/** V */
function trimEnd(text: string, keep: (char: string | undefined) => boolean): string
{
	let end = text.length;
	while (end > 0 && !keep(text[end - 1])) end--;
	return text.slice(0, end);
}

/** H */
function trimStart(text: string, keep: (char: string | undefined) => boolean): string
{
	let start = 0;
	while (start < text.length && !keep(text[start])) start++;
	return text.slice(start);
}

/** he: the seam probe again, cut at break chars but not dots, so domain- and JWT-shaped secrets join across pieces. */
function dottedSeamSecret(pieces: Set<string>): boolean
{
	const tails = new Set<string>();
	const heads = new Set<string>();
	const isJoiner = (char: string | undefined) => char !== undefined && !isWordChar(char) && !isSeparator(char);
	for (const piece of pieces)
	{
		work += piece.length * DOT_PROBE_COST;
		if (work > WORK_BUDGET) return true;
		let last = piece.length - 1;
		while (last >= 0 && !isWordChar(piece[last])) last--;
		if (last < 0) continue;
		let tailStart = last;
		while (tailStart > 0 && !isBreak(piece[tailStart - 1])) tailStart--;
		let first = 0;
		while (!isWordChar(piece[first])) first++;
		let headEnd = first;
		while (headEnd < piece.length && !isBreak(piece[headEnd])) headEnd++;
		tails.add(piece.slice(tailStart, last + 1));
		heads.add(piece.slice(first, headEnd));
		let after = last + 1;
		while (isJoiner(piece[after])) after++;
		if (piece[after] === ".") tails.add(piece.slice(tailStart, after + 1));
		let before = first - 1;
		while (isJoiner(piece[before])) before--;
		if (piece[before] === ".") heads.add(piece.slice(before, headEnd));
	}
	const dotted = (text: string) => text.includes(".");
	const dottedTails = [...tails].filter(dotted);
	const dottedHeads = [...heads].filter(dotted);
	if (dottedTails.length * heads.size + (tails.size - dottedTails.length) * dottedHeads.length > MAX_PAIRS)
		return true;
	for (const tail of tails)
		for (const head of dotted(tail) ? heads : dottedHeads)
			if (probe(tail + head).some((match) => match.start < tail.length && match.end > tail.length)) return true;
	return false;
}

/** U: whether a piece or line's end joined to another's start makes a private key header. */
function keyHeaderAcrossLines({pieces, linesButLast, linesButFirst}: Collected): boolean
{
	const ascii = (text: string) => text.replace(NON_ASCII_ALL, "").replace(/[\t\n\r ]+/g, " ");
	const ends = new Set([...pieces, ...linesButLast].map((text) => trimEnd(ascii(text), isWordChar)));
	const starts = new Set([...pieces, ...linesButFirst].map((text) => trimStart(ascii(text), isWordChar)));
	ends.delete("");
	starts.delete("");
	const totalLength = (sum: number, text: string) => sum + text.length;
	work +=
		ends.size * starts.size * JOIN_PAIR_COST +
		(ends.size * [...starts].reduce(totalLength, 0) + starts.size * [...ends].reduce(totalLength, 0)) /
			JOIN_LENGTH_DIVISOR;
	if (work > WORK_BUDGET) return true;
	for (const end of ends) for (const start of starts) if (PEM_BEGIN.test(end + start)) return true;
	return false;
}

/** W: the split-secret search over everything {@link collect} gathered. */
function splitSecret(collected: Collected): boolean
{
	const {pieces, nodes, lines, runs} = collected;
	if (collected.runsTooLong) return true;
	work = 0;
	for (const text of new Set([...pieces, ...nodes]))
		for (const [run] of text.matchAll(WORD_RUNS))
			if ((run.length > MAX_RUN && NON_ASCII.test(run)) || startsSecret(run)) return true;
	if (pieces.some((piece) => PEM_BEGIN.test(piece) || PEM_BEGIN.test(piece.replace(NON_ASCII_ALL, "")))) return true;
	const joinable = new Set([...pieces, ...lines]);
	return seamSecret(joinable) || dottedSeamSecret(new Set([...joinable, ...runs])) || keyHeaderAcrossLines(collected);
}

/**
 * Upstream `ge`: whether the drawing under `root` must be withheld. True when there is no root or no `<svg>`, when a
 * style could bend its glyphs, when its label text is too long or holds a bidi control, a stand-in glyph or a secret,
 * when a secret could be read across its labels, or when checking costs more than upstream's budget.
 */
export function svgWithheld(root: Node | null): boolean
{
	if (root === null) return true;
	try
	{
		const collected: Collected =
		{
			svg: false,
			altersGlyphs: false,
			nodes: [],
			pieces: [],
			lines: [],
			linesButLast: [],
			linesButFirst: [],
			runs: [],
			runsTooLong: false,
		};
		collect(root, collected, false);
		if (!collected.svg || collected.altersGlyphs) return true;
		return (
			[collected.pieces.join("\n"), collected.nodes.join(NODE_JOIN)].some(
				(text) =>
					text.length > MAX_READ ||
					BIDI_CONTROL.test(text) ||
					STAND_IN_GLYPH.test(text) ||
					findSecrets(text).length > 0,
			) || splitSecret(collected)
		);
	}
	catch
	{
		return true;
	}
}
