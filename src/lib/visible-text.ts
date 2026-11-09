/** Upstream's `hC`: each code point as `[U+XXXX]`. */
function codePointTag(text: string): string {
	return Array.from(
		text,
		(char) => `[U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}]`,
	).join("");
}

/** A literal `[U+` tag or `\uXXXX` escape, whose `[` or `\` is shown so it can't pass for one of ours. */
const LOOKALIKE_RE = /\[(?=U\+[0-9A-F]{4,6}(?:\u00D7[0-9]+)?\])|\\(?=u[0-9a-f]{4})/giu;
/** C0 and C1 controls other than tab and newline. */
// eslint-disable-next-line no-control-regex -- showing control characters is the point
const CONTROL_RE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/gu;
/** Default-ignorable and format characters: zero-width, bidi controls, soft hyphen, tags. */
const IGNORABLE_RE = /[\p{Default_Ignorable_Code_Point}\p{Cf}]/gu;
/** Surrogates, unassigned and private-use code points. */
const UNASSIGNED_RE = /[\p{Cs}\p{Cn}\p{Co}]/gu;
/** Spaces other than the plain space, and blank-looking characters. */
const ODD_SPACE_RE = /(?! )\p{Zs}|[\u2800\uFFFC\u{1D159}\u{13441}\u{13442}\u{16910}\u{16FE4}]/gu;
const SEPARATOR_RE = /[\u2028\u2029]/gu;
const LINE_RE = /[\t\n]/gu;

function hiddenChars(text: string): string {
	return text
		.replace(SEPARATOR_RE, codePointTag)
		.replace(CONTROL_RE, codePointTag)
		.replace(IGNORABLE_RE, codePointTag)
		.replace(UNASSIGNED_RE, codePointTag)
		.replace(ODD_SPACE_RE, codePointTag);
}

/**
 * Text drawn on one line with every invisible, bidi, control and line-breaking character shown as
 * `[U+XXXX]`, as upstream's `SO(text, {singleLine: true})` (shared-18) does for the "Always allow" rules.
 * A `\uXXXX` escape keeps its backslash only when it names a character that would show as itself.
 */
export function visibleSingleLine(text: string): string {
	const unspoofed = text.replace(LOOKALIKE_RE, (match, offset: number) => {
		if (match !== "\\") return codePointTag(match);
		const named = String.fromCodePoint(Number.parseInt(text.slice(offset + 2, offset + 6), 16));
		return hiddenChars(named) === named && !/[\t\n]/u.test(named) ? match : codePointTag(match);
	});
	return hiddenChars(unspoofed).replace(LINE_RE, codePointTag);
}
