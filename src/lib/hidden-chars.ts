/** Upstream's `KG`: control, format, separator, default-ignorable, blank-looking and noncharacter code points. */
const HIDDEN_RE =
	/(?![\t\n])[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u2800\uFFFC\u{1D159}\u{13441}\u{13442}\u{16910}\u{16FE4}\uFDD0-\uFDEF\uFFFE\uFFFF\u{1FFFE}\u{1FFFF}\u{2FFFE}\u{2FFFF}\u{3FFFE}\u{3FFFF}\u{4FFFE}\u{4FFFF}\u{5FFFE}\u{5FFFF}\u{6FFFE}\u{6FFFF}\u{7FFFE}\u{7FFFF}\u{8FFFE}\u{8FFFF}\u{9FFFE}\u{9FFFF}\u{AFFFE}\u{AFFFF}\u{BFFFE}\u{BFFFF}\u{CFFFE}\u{CFFFF}\u{DFFFE}\u{DFFFF}\u{EFFFE}\u{EFFFF}\u{FFFFE}\u{FFFFF}\u{10FFFE}\u{10FFFF}]/gu;

/** ZWNJ, ZWJ and the text/emoji variation selectors: kept, as upstream's `keepLegibilityJoiners`. */
const LEGIBILITY_JOINERS: ReadonlySet<number> = new Set([0x200c, 0x200d, 0xfe0e, 0xfe0f]);

/**
 * Upstream's `kr(text, {keepLegibilityJoiners: true})` (shared-l-p-m-w-0): a C0 control shows as its
 * control picture, DEL as ␡, and every other hidden character as U+FFFD; tab and newline pass.
 */
export function replaceHiddenChars(text: string): string {
	return text.replace(HIDDEN_RE, (char) => {
		const code = char.codePointAt(0) ?? 0;
		if (LEGIBILITY_JOINERS.has(code)) return char;
		if (code <= 31) return String.fromCharCode(0x2400 + code);
		return code === 127 ? "\u2421" : "\uFFFD";
	});
}
