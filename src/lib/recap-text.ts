/**
 * Upstream's recap normaliser (shared-39 `cL` + `dT`): line separators become newlines, whitespace runs
 * collapse to one space, control and format characters (except ZWJ/ZWNJ) are dropped, and the result is
 * capped at 500 UTF-16 units plus "…" without splitting a surrogate pair. Undefined when nothing is left.
 * The CLI's " (disable recaps in /config)" suffix is kept, as upstream keeps it.
 */
const RECAP_CAP = 500;
const CONTROL_OR_FORMAT = /(?![\u200c\u200d])[\p{Cc}\p{Cf}]/gu;

export function recapText(text: string): string | undefined {
	const collapsed = text
		.replace(/[\u2028\u2029]/g, "\n")
		.replace(/\s+/g, " ")
		.replace(CONTROL_OR_FORMAT, "")
		.trim();
	if (collapsed === "") return undefined;
	if (collapsed.length <= RECAP_CAP) return collapsed;
	const end = (collapsed.charCodeAt(RECAP_CAP - 1) & 0xfc00) === 0xd800 ? RECAP_CAP - 1 : RECAP_CAP;
	return `${collapsed.slice(0, end)}…`;
}
