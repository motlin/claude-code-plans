/** Upstream's `va` (shared-41 `pA`): Hebrew and Arabic punctuation that never ends a URL. */
const RTL_PUNCTUATION = "־׃،؛؟۔";
/** Upstream's `$o`: the marks `es` peels off a URL's end. */
const TRAILING_MARKS = `.,;:!?${RTL_PUNCTUATION}`;
/** Upstream's `Qo`: one trailing sentence mark. */
const SENTENCE_MARK = /[.,;:!?]$/;

function count(text: string, char: string): number
{
	return text.split(char).length - 1;
}

/** Upstream's `es`: when the URL ends in a run holding RTL punctuation, that run (and unmatched `)`) dropped. */
function trimRtlRun(url: string): string
{
	let unmatched = count(url, ")") - count(url, "(");
	let rtl = false;
	let end = url.length;
	for (; end > 0; end--)
	{
		const last = url.charAt(end - 1);
		if (last === ")" && unmatched > 0) unmatched--;
		else if (!TRAILING_MARKS.includes(last)) break;
		rtl ||= RTL_PUNCTUATION.includes(last);
	}
	return rtl ? url.slice(0, end) : url;
}

/**
 * Upstream's `ts` (cf6507c5a): a matched URL split into the link and the text after it. An RTL punctuation run
 * goes whole; otherwise one sentence mark, then each `)` without an opener.
 */
export function splitUrlTail(match: string): [url: string, tail: string]
{
	const rtlTrimmed = trimRtlRun(match);
	if (rtlTrimmed !== match) return [rtlTrimmed, match.slice(rtlTrimmed.length)];
	let url = SENTENCE_MARK.test(match) ? match.slice(0, -1) : match;
	const opens = count(url, "(");
	let closes = count(url, ")");
	while (closes > opens && url.endsWith(")"))
	{
		url = url.slice(0, -1);
		closes--;
	}
	return [url, match.slice(url.length)];
}
