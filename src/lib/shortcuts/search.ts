/**
 * The ⌘/ dialog's Search shortcuts filter, ported from claude.ai/code's `ft` (text and pressed-chord
 * matcher) and `ct` (key event → chord) in the shortcuts chunk. See
 * .llm/upstream-sync/features/shortcuts-dialog-delta.md.
 */

import {formatKeys, keyPartLabel} from "./format";

/** A recorded chord: `all` matches any row, `typed` only rows bound by `key` (no `code`). */
export interface PressedChord {
	all: string[];
	typed: string[];
}

export type ShortcutFind = {by: "text"; text: string} | {by: "press"; pressed: PressedChord | null};

/** Matches one row by its label and keys strings; `typedOnly` rows match only typed chords. */
export type ShortcutMatcher = (label: string, keys: readonly string[], typedOnly: boolean) => boolean;

const MODIFIER_ORDER = ["ctrl", "alt", "shift", "cmd"] as const;

const KEY_ALIASES = new Map([
	["command", "cmd"],
	["meta", "cmd"],
	["control", "ctrl"],
	["option", "alt"],
	["escape", "esc"],
	["return", "enter"],
	["delete", "backspace"],
	["arrowup", "up"],
	["arrowdown", "down"],
	["arrowleft", "left"],
	["arrowright", "right"],
	[" ", "space"],
	["+", "plus"],
]);

const MODIFIER_ONLY_KEYS = new Set(
	"Alt AltGraph CapsLock Control Fn FnLock Hyper Meta NumLock OS ScrollLock Shift Super Symbol SymbolLock".split(" "),
);

const UNPRINTABLE_KEYS = new Set(["Dead", "Process", "Unidentified"]);

const CODE_CHARS = new Map([
	["Minus", "-"],
	["Equal", "="],
	["BracketLeft", "["],
	["BracketRight", "]"],
	["Backslash", "\\"],
	["Semicolon", ";"],
	["Quote", "'"],
	["Comma", ","],
	["Period", "."],
	["Slash", "/"],
	["Backquote", "`"],
	["Space", "space"],
]);

const GLYPHS = /[⌘⌥⌃⇧⏎⌫⇥␣↑↓←→]/g;
const ARROW_WORDS = /\barrow (up|down|left|right)\b|\b(up|down|left|right) arrow\b/g;

function isModifier(part: string): boolean {
	return MODIFIER_ORDER.some((modifier) => modifier === part);
}

function normalizePart(part: string, isMac: boolean): string {
	const name = KEY_ALIASES.get(part) ?? part;
	return name === "cmd" && !isMac ? "ctrl" : name;
}

function joinChord(modifiers: ReadonlySet<string>, key: string): string {
	return [...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)), key].join("+");
}

function chordParts(keys: string, isMac: boolean): string[] {
	return keys
		.toLowerCase()
		.split("+")
		.filter((part) => part !== "")
		.map((part) => normalizePart(part, isMac));
}

function expandRange(part: string): string[] {
	const range = /^(\d)…(\d)$/.exec(part);
	if (!range) return [part];
	const start = Number(range[1]);
	return Array.from({length: Number(range[2]) - start + 1}, (_, offset) => String(start + offset));
}

/** Every normalised chord one step stands for, with ranges expanded. */
function chordStrings(keys: string, isMac: boolean): string[] {
	const parts = chordParts(keys, isMac);
	const modifiers = new Set(parts.filter(isModifier));
	return parts
		.filter((part) => !modifiers.has(part))
		.flatMap(expandRange)
		.map((key) => joinChord(modifiers, key));
}

function partAliases(part: string, isMac: boolean): string[] {
	const label = keyPartLabel(part, isMac);
	return [
		...expandRange(part),
		...["cmd", ...KEY_ALIASES.keys()].filter((name) => normalizePart(name, isMac) === part),
		label.label.toLowerCase(),
		label.spoken?.toLowerCase() ?? part,
	];
}

/** Each token must prefix-match an alias of a different key part. */
function matchesDistinctParts(tokens: readonly string[], parts: readonly (readonly string[])[]): boolean {
	const [first, ...rest] = tokens;
	if (first === undefined) return true;
	if (tokens.length > parts.length) return false;
	return parts.some(
		(aliases, index) =>
			aliases.some((alias) => alias.startsWith(first)) && matchesDistinctParts(rest, parts.toSpliced(index, 1)),
	);
}

/** The row matcher for a find state, or null when nothing filters. */
export function shortcutMatcher(find: ShortcutFind, isMac: boolean): ShortcutMatcher | null {
	if (find.by === "press") {
		const {pressed} = find;
		if (pressed === null) return null;
		return (_label, keys, typedOnly) => {
			const chords = typedOnly ? pressed.typed : pressed.all;
			return keys.some((keyString) =>
				keyString
					.split(/\s+/)
					.some((step) => chordStrings(step, isMac).some((chord) => chords.includes(chord))),
			);
		};
	}
	const query = find.text.toLowerCase();
	const terms = query.split(/\s+/).filter((term) => term !== "");
	if (terms.length === 0) return null;
	const tokens = query
		.replace(ARROW_WORDS, "$1$2")
		.replace(GLYPHS, " $& ")
		.split(/[\s+]+/)
		.filter((token) => token !== "");
	return (label, keys) => {
		const lowerLabel = label.toLowerCase();
		if (terms.every((term) => lowerLabel.includes(term))) return true;
		return (
			tokens.length > 0 &&
			keys.some((keyString) => {
				const parts = keyString
					.split(/\s+/)
					.flatMap((step) => chordParts(step, isMac))
					.map((part) => partAliases(part, isMac));
				return matchesDistinctParts(tokens, parts);
			})
		);
	};
}

type ChordKeyEvent = Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"> & {
	keyCode?: number;
};

function unique(values: readonly string[]): string[] {
	return [...new Set(values)];
}

/** Layout-independent chords for a keydown (upstream `ct`), or null for modifier-only presses. */
export function chordFromEvent(event: ChordKeyEvent, isMac: boolean): PressedChord | null {
	if (MODIFIER_ONLY_KEYS.has(event.key) || (event.metaKey && !isMac)) return null;
	const modifiers = new Set<string>();
	if (event.ctrlKey) modifiers.add("ctrl");
	if (event.altKey) modifiers.add("alt");
	if (event.shiftKey) modifiers.add("shift");
	if (event.metaKey) modifiers.add("cmd");
	const codeKey =
		/^(?:Key|Digit|Numpad)([A-Z0-9])$/.exec(event.code)?.[1]?.toLowerCase() ?? CODE_CHARS.get(event.code);
	const keyCode = event.keyCode ?? 0;
	// Mac Option rewrites the typed letter (⌥R types ®), so keep the letter keyCode names.
	const optionLetter =
		isMac && event.altKey && keyCode >= 65 && keyCode <= 90
			? String.fromCharCode(keyCode).toLowerCase()
			: undefined;
	const physical = [...new Set([optionLetter, codeKey])]
		.filter((key) => key !== undefined)
		.map((key) => joinChord(modifiers, key));
	if (UNPRINTABLE_KEYS.has(event.key)) return physical.length === 0 ? null : {all: physical, typed: []};
	const key = event.key === "Delete" ? "del" : normalizePart(event.key.toLowerCase(), isMac);
	const typed = [key, ...(key === "=" ? ["plus"] : [])].map((name) => joinChord(modifiers, name));
	if (event.key.length > 1) return {all: typed, typed};
	const plainLatin =
		/^[\p{Script=Latin}\p{Script=Common}]$/u.test(event.key) &&
		event.key.toUpperCase().length === 1 &&
		!event.shiftKey &&
		!event.altKey;
	if (/^[a-z0-9]$/i.test(event.key) || plainLatin) return {all: unique([...typed, ...physical]), typed};
	const unshifted = new Set(modifiers);
	unshifted.delete("shift");
	return {
		all: unique([...physical, ...typed, joinChord(unshifted, key)]),
		typed: event.shiftKey && !event.altKey && /^[ -~]$/.test(event.key) ? [...typed, ...physical] : typed,
	};
}

/** The chord as the field shows it: "⌘K" on mac, "Ctrl+K" elsewhere. */
export function chordLabel(chord: string, isMac: boolean): string {
	return formatKeys(chord, isMac)
		.map((label) => label.label)
		.join(isMac ? "" : "+");
}

/** The text typed after a shown chord (upstream `lt`): drops the chord's common prefix up to the caret. */
export function stripChordPrefix(value: string, chordText: string, end = value.length): string {
	if (chordText === "") return value;
	let index = 0;
	while (index < end && value[index] === chordText[index]) index += 1;
	return value.slice(index, end);
}
