/**
 * Upstream claude.ai/code's smart-quote pass for assistant prose, ported from
 * its bundle: it curls only `"` and `'` (no dashes or ellipses), carrying the
 * previous character across the text runs of one paragraph, heading or cell.
 */

/** Upstream's streaming marker, which every lookaround skips. */
const MARK = 0xfdee;
const DOUBLE = 34;
const SINGLE = 39;
const LEFT_DOUBLE = 0x201c;
const RIGHT_DOUBLE = 0x201d;
const LEFT_SINGLE = 0x2018;
const RIGHT_SINGLE = 0x2019;
const EQUALS = 61;
const SPACE = 32;
/** Any letter: the previous character after code, an image or other opaque inline content. */
const WORD = 97;
const NONE = -1;
const HYPHEN = 45;
const COLON = 58;
const OPEN_PAREN = 40;
const CLOSE_PAREN = 41;
const VS15 = 0xfe0e;
const VS16 = 0xfe0f;
/** The longest run of quotes a Lisp-style quote check looks through. */
const MAX_QUOTE_RUN = 3;

/** How the last quote of a kind left its pair. */
const Pair = {Closed: 0, Open: 1, Literal: 2, Attribute: 3} as const;
type Pair = (typeof Pair)[keyof typeof Pair];

export interface QuoteState {
	prev: number;
	beforePrev: number;
	double: Pair;
	single: Pair;
}

export function newQuoteState(): QuoteState {
	return {prev: SPACE, beforePrev: NONE, double: Pair.Closed, single: Pair.Closed};
}

/** Treat what follows as coming after a word, as upstream does after opaque inline content. */
export function afterOpaque(state: QuoteState): void {
	state.prev = WORD;
	state.beforePrev = WORD;
}

/** Treat what follows as coming after whitespace, as after a line break. */
export function afterBreak(state: QuoteState): void {
	state.prev = SPACE;
}

function isSpace(c: number): boolean {
	return (
		c === SPACE ||
		(c >= 9 && c <= 13) ||
		c === 160 ||
		(c >= 8192 && c <= 8202) ||
		c === 8232 ||
		c === 8233 ||
		c === 8239 ||
		c === 12288
	);
}

function isSurrogate(c: number): boolean {
	return c >= 0xd800 && c <= 0xdfff;
}

const SYMBOLS = new Set([169, 174, 8252, 8265, 8482, 8505, 9410, 10548, 10549]);

function isSymbol(c: number): boolean {
	return (
		(c >= 8592 && c <= 8703) ||
		(c >= 8960 && c <= 9215) ||
		(c >= 9632 && c <= 10175) ||
		(c >= 11008 && c <= 11263) ||
		c === VS15 ||
		c === VS16 ||
		SYMBOLS.has(c)
	);
}

function isDigit(c: number): boolean {
	return c >= 48 && c <= 57;
}

function isFraction(c: number): boolean {
	return (c >= 188 && c <= 190) || (c >= 8528 && c <= 8542);
}

function isNumeric(c: number): boolean {
	return isDigit(c) || isFraction(c);
}

function isLatin(c: number): boolean {
	return (
		(c >= 97 && c <= 122) ||
		(c >= 65 && c <= 90) ||
		(c >= 192 && c <= 879 && c !== 215 && c !== 247) ||
		(c >= 7680 && c <= 7935)
	);
}

/** Scripts whose quotes upstream leaves straight: Greek through CJK and full-width forms. */
function isWide(c: number): boolean {
	if (isSpace(c)) return false;
	return (
		(c >= 880 && c <= 7679) ||
		(c >= 7936 && c <= 8191) ||
		(c >= 11264 && c <= 55295) ||
		(c >= 63744 && c <= 65023) ||
		(c >= 65136 && c <= 65278) ||
		(c >= 65280 && c <= 65519)
	);
}

function isLetter(c: number): boolean {
	return isLatin(c) || isWide(c);
}

function isWordChar(c: number): boolean {
	return isLetter(c) || isDigit(c);
}

const OPENERS = new Set([40, 91, 123, HYPHEN, 8211, 8212, LEFT_DOUBLE, LEFT_SINGLE]);

function opensAfter(prev: number, quote: number): boolean {
	return prev !== quote && (isSpace(prev) || OPENERS.has(prev));
}

function closesBefore(prev: number, pair: Pair, next: number): boolean {
	return !isSpace(prev) && pair !== Pair.Closed && !isWordChar(next) && next !== HYPHEN;
}

function skipForward(text: string, index: number): number {
	let i = index;
	while (i < text.length && text.charCodeAt(i) === MARK) i++;
	return i;
}

function charAt(text: string, index: number): number {
	return index < text.length ? text.charCodeAt(index) : NONE;
}

function prevIndex(text: string, index: number): number {
	let i = index - 1;
	while (i >= 0 && text.charCodeAt(i) === MARK) i--;
	return i;
}

/** Whether the `"` at `index` closes a feet-and-inches measure like 5'10". */
function closesMeasure(text: string, index: number): boolean {
	let i = prevIndex(text, index);
	if (i >= 0 && isFraction(text.charCodeAt(i))) i = prevIndex(text, i);
	let inches = 0;
	while (inches < 3 && i >= 0 && isDigit(text.charCodeAt(i))) {
		inches++;
		i = prevIndex(text, i);
	}
	if (inches < 1 || inches > 2 || i < 0 || text.charCodeAt(i) !== SINGLE) return false;
	i = prevIndex(text, i);
	let feet = 0;
	while (feet < 2 && i >= 0 && isDigit(text.charCodeAt(i))) {
		feet++;
		i = prevIndex(text, i);
	}
	return feet > 0 && (i < 0 || !isWordChar(text.charCodeAt(i)));
}

/** Whether the character two before `index` is a word character. */
function wordTwoBefore(text: string, index: number, fallback: number): boolean {
	const before = prevIndex(text, index);
	if (before < 0) return false;
	const twoBefore = prevIndex(text, before);
	return isWordChar(twoBefore >= 0 ? text.charCodeAt(twoBefore) : fallback);
}

const NON_LISP_LETTERS = new Set([100, 106, 108, 111]);

/** Upstream's check for a Lisp-style quote, such as `f'(x)`, that stays straight. */
function isLispQuote(text: string, nextIndex: number, fallback: number, beforePrev: number, prev: number): boolean {
	const quote = prevIndex(text, nextIndex);
	let run = 1;
	let before = prevIndex(text, quote);
	if (before >= 0 && text.charCodeAt(before) === SINGLE && prev !== SINGLE) return false;
	while (before >= 0 && text.charCodeAt(before) === SINGLE) {
		if (++run > MAX_QUOTE_RUN) return false;
		before = prevIndex(text, before);
	}
	const head = before >= 0 ? text.charCodeAt(before) : fallback;
	if (head !== CLOSE_PAREN) {
		if (!isLatin(head) || NON_LISP_LETTERS.has(head)) return false;
		let preceding = beforePrev;
		if (before >= 0) {
			const i = prevIndex(text, before);
			preceding = i >= 0 ? text.charCodeAt(i) : fallback;
		}
		if (isLetter(preceding) || preceding === SINGLE || preceding === LEFT_SINGLE || preceding === RIGHT_SINGLE) {
			return false;
		}
	}
	let after = nextIndex;
	while (charAt(text, after) === SINGLE) {
		if (++run > MAX_QUOTE_RUN) return false;
		after = skipForward(text, after + 1);
	}
	return charAt(text, after) === OPEN_PAREN;
}

const ELISIONS = ["em", "tis", "twas", "cause", "n'"];

/** Whether `word` (lower case) starts at `index` and ends a word. */
function wordAt(text: string, index: number, word: string): boolean {
	let i = index;
	for (let k = 0; k < word.length; k++) {
		i = skipForward(text, i);
		const c = charAt(text, i);
		if ((c >= 65 && c <= 90 ? c + 32 : c) !== word.charCodeAt(k)) return false;
		i++;
	}
	return !isWordChar(charAt(text, skipForward(text, i)));
}

function isDecade(text: string, index: number): boolean {
	let i = skipForward(text, index);
	if (!isDigit(charAt(text, i))) return false;
	i = skipForward(text, i + 1);
	if (!isDigit(charAt(text, i))) return false;
	return wordAt(text, i + 1, "s");
}

/** Whether a leading `'` elides the start of a word: '90s, 'em, 'tis, rock 'n' roll. */
function isElision(text: string, index: number): boolean {
	return isDecade(text, index) || ELISIONS.some((word) => wordAt(text, index, word));
}

function doubleQuote(state: QuoteState, next: number, text: string, index: number, fallback: number): number {
	const {prev} = state;
	if ((isWordChar(prev) || isFraction(prev)) && isWordChar(next)) {
		if (state.double === Pair.Open && !isNumeric(prev) && !isDigit(next)) {
			state.double = Pair.Closed;
			return RIGHT_DOUBLE;
		}
		state.double = (!isWide(prev) && !isWide(next)) || state.double !== Pair.Literal ? Pair.Literal : Pair.Closed;
		return DOUBLE;
	}
	if (
		(opensAfter(prev, LEFT_DOUBLE) ||
			isSurrogate(prev) ||
			(state.double === Pair.Closed &&
				((isSymbol(prev) && isWordChar(next)) ||
					(prev === COLON && (isLatin(next) || isDigit(next)) && wordTwoBefore(text, index, fallback))))) &&
		!closesBefore(prev, state.double, next)
	) {
		state.double = isWide(next) ? Pair.Literal : Pair.Open;
		return state.double === Pair.Open ? LEFT_DOUBLE : DOUBLE;
	}
	if (prev === EQUALS && (state.double !== Pair.Open || isWordChar(next))) {
		state.double = state.double === Pair.Open ? Pair.Attribute : Pair.Literal;
		return DOUBLE;
	}
	if (
		state.double === Pair.Open &&
		(isSpace(next) || next === NONE || next === DOUBLE) &&
		closesMeasure(text, index)
	) {
		return DOUBLE;
	}
	const pair = state.double;
	state.double = pair === Pair.Attribute ? Pair.Open : Pair.Closed;
	if (pair === Pair.Attribute) return DOUBLE;
	if (pair === Pair.Open) return RIGHT_DOUBLE;
	return pair === Pair.Literal || isNumeric(prev) || isWide(prev) ? DOUBLE : RIGHT_DOUBLE;
}

function singleQuote(state: QuoteState, next: number, text: string, nextIndex: number, fallback: number): number {
	const {prev} = state;
	if (opensAfter(prev, LEFT_SINGLE) && !closesBefore(prev, state.single, next)) {
		if (isWide(next)) {
			state.single = Pair.Literal;
			return SINGLE;
		}
		if (isElision(text, nextIndex)) return RIGHT_SINGLE;
		state.single = Pair.Open;
		return LEFT_SINGLE;
	}
	if (prev === EQUALS && (state.single !== Pair.Open || isWordChar(next))) {
		state.single = state.single === Pair.Open ? Pair.Attribute : Pair.Literal;
		return SINGLE;
	}
	if (isWordChar(prev) && isWordChar(next)) {
		if (isWide(prev) && isWide(next)) return SINGLE;
		if (isWide(prev) || isWide(next)) {
			if (state.single === Pair.Open) {
				state.single = Pair.Closed;
				return RIGHT_SINGLE;
			}
			state.single = state.single === Pair.Literal ? Pair.Closed : Pair.Literal;
			return SINGLE;
		}
		return isDigit(prev) && !wordAt(text, nextIndex, "s") ? SINGLE : RIGHT_SINGLE;
	}
	if (state.single === Pair.Closed && isLispQuote(text, nextIndex, fallback, state.beforePrev, prev)) return SINGLE;
	const pair = state.single;
	state.single = pair === Pair.Attribute ? Pair.Open : Pair.Closed;
	return pair === Pair.Attribute ||
		pair === Pair.Literal ||
		isWide(prev) ||
		((isDigit(prev) || (isFraction(prev) && !wordAt(text, nextIndex, "s"))) && pair !== Pair.Open)
		? SINGLE
		: RIGHT_SINGLE;
}

/** Curl the quotes of one text run, carrying `state` on to the next run. */
export function smartenQuotes(text: string, state: QuoteState): string {
	const fallback = state.prev;
	let double = text.indexOf('"');
	let single = text.indexOf("'");
	let out = "";
	let from = 0;
	let last = -1;
	while (double !== -1 || single !== -1) {
		const isDouble = single === -1 || (double !== -1 && double < single);
		const at = isDouble ? double : single;
		const before = prevIndex(text, at);
		if (before > last) state.prev = text.charCodeAt(before);
		const nextIndex = skipForward(text, at + 1);
		const next = charAt(text, nextIndex);
		const chosen = isDouble
			? doubleQuote(state, next, text, at, fallback)
			: singleQuote(state, next, text, nextIndex, fallback);
		if (chosen !== (isDouble ? DOUBLE : SINGLE)) {
			out += text.slice(from, at) + String.fromCharCode(chosen);
			from = at + 1;
		}
		state.prev = chosen;
		last = at;
		if (isDouble) double = text.indexOf('"', at + 1);
		else single = text.indexOf("'", at + 1);
	}
	const tail = prevIndex(text, text.length);
	if (tail > last) {
		state.prev = text.charCodeAt(tail);
		const beforeTail = prevIndex(text, tail);
		state.beforePrev = beforeTail >= 0 ? text.charCodeAt(beforeTail) : NONE;
	}
	return from === 0 ? text : out + text.slice(from);
}
