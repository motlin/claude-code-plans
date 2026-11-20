/** Upstream `Cr`: how many chars of a line a reply tile's name keeps before clipping. */
const NAME_PART_MAX_CHARS = 40;

/**
 * Upstream `wr`: the first line with content, trimmed, clipped past 40 chars to 39 and an ellipsis (38 when
 * the cut would split a surrogate pair).
 */
export function clipFirstLine(text: string): string
{
	const line = (text.split("\n").find((each) => each.trim() !== "") ?? text).trim();
	if (line.length <= NAME_PART_MAX_CHARS) return line;
	const code = line.charCodeAt(38);
	const end = code >= 0xd800 && code <= 0xdbff ? 38 : 39;
	return `${line.slice(0, end)}…`;
}

/** Upstream `za`: a staged reply's accessible name, badge hint and remove label. */
export function replyTileName(quote: string, comment: string): string
{
	return `Your reply to “${clipFirstLine(quote)}”: ${clipFirstLine(comment)}`;
}

/** What a staged reply's preview shows: every quote line as `> line`, a blank line, then the comment. */
export function replyPreviewText(quote: string, comment: string): string
{
	return `${quote
		.split(/\r\n?|\n/)
		.map((line) => `> ${line}`)
		.join("\n")}\n\n${comment}`;
}

/** Upstream `$a` as a row: `formatList(["Excerpt", Fr(text)], {type: "unit"})`, a plain excerpt row's name. */
export function excerptRowName(text: string): string
{
	return `Excerpt, ${clipFirstLine(text)}`;
}
