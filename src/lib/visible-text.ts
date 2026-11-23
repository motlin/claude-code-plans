/** Upstream's `hC`: each code point as `[U+XXXX]`. */
function codePointTag(text: string): string
{
	return Array.from(
		text,
		(char) => `[U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}]`,
	).join("");
}

/** Upstream's `TT` (shared-0): a C0 or C1 control other than tab and newline (a CRLF's CR kept), or a line separator. */
// eslint-disable-next-line no-control-regex -- showing control characters is the point
const CONTROL_OR_SEPARATOR_RE = /(?!\r\n)(?:[\u0000-\u0008\u000B-\u001F\u007F-\u009F]|[\u2028\u2029])/g;

/** Upstream's `Jr` (shared-0): control characters and line separators shown as `[U+XXXX]`; nothing else. */
export function revealControlChars(text: string): string
{
	return text.replace(CONTROL_OR_SEPARATOR_RE, codePointTag);
}

/** A literal `[U+` tag or `\uXXXX` escape, whose `[` or `\` is shown so it can't pass for one of ours. */
const LOOKALIKE_RE = /\[(?=U\+[0-9A-F]{4,6}(?:\u00D7[0-9]+)?\])|\\(?=u[0-9a-f]{4})/giu;
/** C0 and C1 controls other than tab and newline. */
// eslint-disable-next-line no-control-regex -- showing control characters is the point
const CONTROL_RE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/gu;
/** Default-ignorable and format characters: zero-width, bidi controls, soft hyphen, tags. */
const IGNORABLE_RE = /[\p{Default_Ignorable_Code_Point}\p{Cf}]/gu;
/** Upstream's `Vr` (`emojiStyle`): as `IGNORABLE_RE`, but U+FE0F kept after a pictograph it turns into an emoji. */
const IGNORABLE_EMOJI_STYLE_RE =
	/(?<!(?![\p{Emoji_Presentation}\p{Cn}])\p{Extended_Pictographic})\uFE0F|(?!\uFE0F)[\p{Default_Ignorable_Code_Point}\p{Cf}]/gu;
/** Surrogates, unassigned and private-use code points. */
const UNASSIGNED_RE = /[\p{Cs}\p{Cn}\p{Co}]/gu;
/** Spaces other than the plain space, and blank-looking characters. */
const ODD_SPACE_RE = /(?! )\p{Zs}|[\u2800\uFFFC\u{1D159}\u{13441}\u{13442}\u{16910}\u{16FE4}]/gu;
const SEPARATOR_RE = /[\u2028\u2029]/gu;
const LINE_RE = /[\t\n]/gu;

function hiddenChars(text: string, emojiStyle: boolean): string
{
	return text
		.replace(SEPARATOR_RE, codePointTag)
		.replace(CONTROL_RE, codePointTag)
		.replace(emojiStyle ? IGNORABLE_EMOJI_STYLE_RE : IGNORABLE_RE, codePointTag)
		.replace(UNASSIGNED_RE, codePointTag)
		.replace(ODD_SPACE_RE, codePointTag);
}

/**
 * Text with every invisible, bidi and control character shown as `[U+XXXX]`, keeping tabs and newlines, as
 * upstream's `SO(text)` (shared-18) does for a permission card's folded text (`bn`).
 * A `\uXXXX` escape keeps its backslash only when it names a character that would show as itself. With `emojiStyle`
 * (upstream's `{emojiStyle: true}`), a U+FE0F that makes a pictograph an emoji is kept.
 */
export function visibleMultiline(
	text: string,
	{
		emojiStyle = false,
	}:
	{
		emojiStyle?: boolean;
	} = {},
): string
{
	const unspoofed = text.replace(LOOKALIKE_RE, (match, offset: number) =>
	{
		if (match !== "\\") return codePointTag(match);
		const named = String.fromCodePoint(Number.parseInt(text.slice(offset + 2, offset + 6), 16));
		return hiddenChars(named, emojiStyle) === named && !/[\t\n]/u.test(named) ? match : codePointTag(match);
	});
	return hiddenChars(unspoofed, emojiStyle);
}

/**
 * Text drawn on one line, as `visibleMultiline` with tabs and newlines tagged too: upstream's
 * `SO(text, {singleLine: true})` (shared-18) for the "Always allow" rules.
 */
export function visibleSingleLine(text: string): string
{
	return visibleMultiline(text).replace(LINE_RE, codePointTag);
}

/** Strong right-to-left letters: Hebrew, Arabic, Syriac, Thaana, NKo, Samaritan, Mandaic and their presentation forms. */
const RTL_CHAR = String.raw`[֐-ࣿיִ-﷿ﹰ-ﻼ\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]`;
/** A run of RTL letters, keeping the spaces and marks between two of them. */
const RTL_RUN_RE = new RegExp(String.raw`${RTL_CHAR}(?:[\s\p{M}]*${RTL_CHAR})*`, "gu");

export interface BidiRun
{
	text: string;
	rtl: boolean;
}

/** Split text into left-to-right and right-to-left runs, as upstream's path rendering (cf0704cb0 `s`) does. */
export function bidiRuns(text: string): BidiRun[]
{
	const runs: BidiRun[] = [];
	let last = 0;
	for (const match of text.matchAll(RTL_RUN_RE))
	{
		if (match.index > last)
			runs.push(
				{
					text: text.slice(last, match.index),
					rtl: false,
				},
			);
		runs.push(
			{
				text: match[0],
				rtl: true,
			},
		);
		last = match.index + match[0].length;
	}
	if (last < text.length)
		runs.push(
			{
				text: text.slice(last),
				rtl: false,
			},
		);
	return runs;
}

/** Plain text for a `title`: each RTL run wrapped in a right-to-left isolate (U+2067 … U+2069). */
export function bidiIsolatedText(runs: readonly BidiRun[]): string
{
	return runs.map((run) => (run.rtl ? `⁧${run.text}⁩` : run.text)).join("");
}

/**
 * Upstream's `_n` (shared-frame): a hidden character (control, format, separator, default-ignorable,
 * blank-looking or noncharacter) with any surrogates around it, else a run of lone high surrogates (kept).
 */
const TITLE_HIDDEN_RE =
	/[\uD800-\uDBFF]*[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}⠀￼\u{1D159}\u{13441}\u{13442}\u{16910}\u{16FE4}﷐-﷯￾￿\u{1FFFE}\u{1FFFF}\u{2FFFE}\u{2FFFF}\u{3FFFE}\u{3FFFF}\u{4FFFE}\u{4FFFF}\u{5FFFE}\u{5FFFF}\u{6FFFE}\u{6FFFF}\u{7FFFE}\u{7FFFF}\u{8FFFE}\u{8FFFF}\u{9FFFE}\u{9FFFF}\u{AFFFE}\u{AFFFF}\u{BFFFE}\u{BFFFF}\u{CFFFE}\u{CFFFF}\u{DFFFE}\u{DFFFF}\u{EFFFE}\u{EFFFF}\u{FFFFE}\u{FFFFF}\u{10FFFE}\u{10FFFF}][\uDC00-\uDFFF]*|([\uD800-\uDBFF]+)/gu;
/** Right-to-left letters or U+FFFD, which upstream won't put in a native tooltip. */
const TITLE_RTL_RE = /[֐-ࣿיִ-﷿ﹰ-﻿\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}�]/u;
/** A lone surrogate. */
const LONE_SURROGATE_RE = /[\uD800-\uDFFF]/u;

/**
 * A native `title` for display text, as upstream's `CP` (shared-frame): hidden characters dropped
 * (`sV`), and no title at all when the result is empty, holds right-to-left text or U+FFFD, or the
 * text has a lone surrogate -- a browser tooltip can't isolate those, so it would show them reordered.
 */
export function nativeTitle(text: string): string | undefined
{
	const cleaned = text.replace(TITLE_HIDDEN_RE, "$1");
	if (cleaned === "" || TITLE_RTL_RE.test(cleaned) || LONE_SURROGATE_RE.test(text)) return undefined;
	return cleaned;
}

/** Upstream's `QR`: a keycap (kept), else a bidi control, tag, combining overlay or enclosing mark, an invisible RTL-range format character, or a run of invisibles or marks. */
const REVEAL_RE =
	/([0-9#*]\u{FE0F}\u{20E3}(?![\p{Mn}\p{Me}]))|[\p{Bidi_Control}\u{E0000}-\u{E01EF}\u{334}-\u{338}\u{20D0}-\u{20FF}\p{Me}]|(?=[\p{Default_Ignorable_Code_Point}\p{Cf}])[\u{590}-\u{8FF}\u{FB1D}-\u{FDFF}\u{FE70}-\u{FEFE}\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]|[\p{Default_Ignorable_Code_Point}\p{Cf}]{3,}|[\p{Mn}\p{Me}]{4,}/gu;
/** Upstream's `Aa`: an invisible character outside a keycap. */
const INVISIBLE_RE = /(?!\u{FE0F}\u{20E3})[\p{Default_Ignorable_Code_Point}\p{Cf}]/gu;
/** Upstream's `nD`: more invisibles than this and every one is shown. */
const INVISIBLE_LIMIT = 16;
/** Upstream's `mZ` (with `YE`): an odd space or blank-looking character. */
const ODD_BLANK = String.raw`(?:[^\P{Zs} ]|[\u{2800}\u{FFFC}\u{1D159}\u{13441}\u{13442}\u{16910}\u{16FE4}])`;
/** Upstream's `N_`: three or more odd blanks in a row, with spacing, invisibles and marks between. */
const BLANK_RUN_RE = new RegExp(
	String.raw`${ODD_BLANK}(?:[\t \p{Default_Ignorable_Code_Point}\p{Cf}\p{Mn}\p{Me}]*${ODD_BLANK}){2,}[\p{Mn}\p{Me}]*`,
	"gu",
);
/** Upstream's `y$I`: a character that draws something. */
const VISIBLE_RE =
	/[^\s\u{2800}\u{FFFC}\u{1D159}\u{13441}\u{13442}\u{16910}\p{Default_Ignorable_Code_Point}\p{Cf}\p{Mn}\p{Me}]/u;
/** Upstream's `zH`: a line's content. */
const LINE_CONTENT_RE = /[^\n\r\u{85}\u{2028}\u{2029}]+/gu;

/** Upstream's `jd`: every character but space and tab as `[U+XXXX]`. */
function tagBlanks(text: string): string
{
	return Array.from(text, (char) => (char === " " || char === "\t" ? char : codePointTag(char))).join("");
}

/** Upstream's `ko`: on a line that draws something, runs of odd blanks are shown. */
function revealBlankRuns(line: string): string
{
	return VISIBLE_RE.test(line) ? line.replace(BLANK_RUN_RE, tagBlanks) : line;
}

/**
 * Upstream's `u9` (shared-0): spoofing characters (bidi controls, tags, overlays, invisible runs) shown
 * as `[U+XXXX]`, every invisible when there are more than 16, and runs of odd blanks on a visible line.
 */
export function revealSpoofing(text: string): string
{
	const revealed = text.replace(REVEAL_RE, (match, keycap: string | undefined) => keycap ?? codePointTag(match));
	const invisibles = revealed.match(INVISIBLE_RE)?.length ?? 0;
	return (invisibles > INVISIBLE_LIMIT ? revealed.replace(INVISIBLE_RE, codePointTag) : revealed).replace(
		LINE_CONTENT_RE,
		revealBlankRuns,
	);
}

/** Upstream's `FN` (shared-l-p-m-w-0): a right-to-left script letter. */
export const RTL_SCRIPT_RE = /[֐-ࣿיִ-﷿ﹰ-﻿\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u;
/** Upstream's `w` (cc87bae22): Arabic digits and number signs, which read left to right inside RTL text. */
const ARABIC_NUMBER_CLASS = String.raw`؀-؅٠-٩٫٬۝۰-۹࢐࢑࣢\u{10D30}-\u{10D39}\u{10D40}-\u{10D49}\u{10E60}-\u{10E7E}`;
const RTL_SCRIPT_CLASS = RTL_SCRIPT_RE.source.slice(1, -1);
/** Upstream's `E`: an RTL letter that isn't an Arabic number. */
const RTL_LETTER_RE = new RegExp(String.raw`^(?![${ARABIC_NUMBER_CLASS}])[${RTL_SCRIPT_CLASS}]$`, "u");
/** Upstream's `D`: an Arabic number character. */
const ARABIC_NUMBER_RE = new RegExp(String.raw`^[${ARABIC_NUMBER_CLASS}]$`, "u");
/** Upstream's `A` (c2d1aeb56): a combining mark or ZWNJ that clings to the RTL run before it. */
const CLINGING_MARK_RE = /^(?![ಿೆ\u{11A07}\u{11A08}\u{11C3F}])[\p{Mn}\p{Me}‌]$/u;

export interface DirectionRun
{
	text: string;
	dir?: "ltr" | "rtl";
}

/** Upstream's `O` (cc87bae22): split a word into runs of RTL letters, Arabic numbers and everything else. */
function directionRuns(word: string): DirectionRun[]
{
	const runs: DirectionRun[] = [];
	let start = 0;
	let offset = 0;
	let dir: DirectionRun["dir"];
	const flush = (end: number) =>
	{
		if (end <= start) return;
		const text = word.slice(start, end);
		runs.push(
			dir === undefined
				?
					{
						text,
					}
				:
					{
						text,
						dir,
					},
		);
		start = end;
	};
	for (const char of word)
	{
		const next = String.fromCodePoint(word.codePointAt(offset + 1) ?? 32);
		const charDir =
			(char === " " && dir === "rtl" && RTL_LETTER_RE.test(next)) || RTL_LETTER_RE.test(char)
				? "rtl"
				: ARABIC_NUMBER_RE.test(char)
					? "ltr"
					: undefined;
		if (charDir !== dir)
		{
			flush(offset);
			dir = charDir;
		}
		offset += char.length;
	}
	flush(offset);
	return runs;
}

/** Upstream's `j`: the leading marks of `text` that cling to an RTL run. */
function clingingMarks(text: string): string
{
	let length = 0;
	for (const char of text)
	{
		if (!CLINGING_MARK_RE.test(char)) break;
		length += char.length;
	}
	return text.slice(0, length);
}

/** Upstream's `M`: neutral runs merged, and marks after an RTL run folded into it. */
function mergeRuns(runs: readonly DirectionRun[]): DirectionRun[]
{
	const merged: DirectionRun[] = [];
	for (const run of runs)
	{
		const last = merged.at(-1);
		if (last !== undefined && last.dir === undefined && run.dir === undefined)
		{
			last.text += run.text;
			continue;
		}
		if (last?.dir !== "rtl" || run.dir === "ltr")
		{
			merged.push(
				{
					...run,
				},
			);
			continue;
		}
		const folded = run.dir === "rtl" ? run.text : clingingMarks(run.text);
		last.text += folded;
		if (folded.length < run.text.length)
			merged.push(
				{
					text: run.text.slice(folded.length),
				},
			);
	}
	return merged;
}

/** Upstream's `N` (c2d1aeb56 `_bH`): a line's direction runs, split word by word so spaces stay neutral. */
export function lineDirectionRuns(line: string): DirectionRun[]
{
	return mergeRuns(
		line.split(" ").flatMap((word, index) =>
			index === 0
				? directionRuns(word)
				: [
						{
							text: " ",
						},
						...directionRuns(word),
					],
		),
	);
}
