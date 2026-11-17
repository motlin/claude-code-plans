/** Upstream's emoji-suggestion input rule: an emoticon typed at a line start or after whitespace becomes an emoji on the next space. */

/** Upstream `E`, entry for entry. */
export const EMOTICONS: Readonly<Record<string, string>> =
{
	"<3": "❤️",
	"</3": "\u{1F494}",
	":)": "\u{1F642}",
	":-)": "\u{1F642}",
	":(": "\u{1F61E}",
	":-(": "\u{1F61E}",
	":'(": "\u{1F622}",
	">:(": "\u{1F620}",
	":D": "\u{1F603}",
	":-D": "\u{1F603}",
	":/": "\u{1F615}",
	":-/": "\u{1F615}",
	":\\": "\u{1F615}",
	":-\\": "\u{1F615}",
	":|": "\u{1F610}",
	":-|": "\u{1F610}",
	":*": "\u{1F618}",
	":-*": "\u{1F618}",
	":o": "\u{1F62E}",
	":O": "\u{1F62E}",
	":-o": "\u{1F62E}",
	":-O": "\u{1F62E}",
	":p": "\u{1F61B}",
	":P": "\u{1F61B}",
	":-p": "\u{1F61B}",
	":-P": "\u{1F61B}",
	";)": "\u{1F609}",
	";-)": "\u{1F609}",
	";p": "\u{1F61C}",
	";P": "\u{1F61C}",
	";-p": "\u{1F61C}",
	";-P": "\u{1F61C}",
};

function escapeRegExp(text: string): string
{
	return text.replaceAll(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

/** Upstream `O`: the keys longest first, so `>:(` wins over `:(`, then the typed space. */
export const EMOTICON_RULE = new RegExp(
	`(^|\\s)(${Object.keys(EMOTICONS)
		.toSorted((a, b) => b.length - a.length)
		.map(escapeRegExp)
		.join("|")}) $`,
);

export interface EmoticonMatch
{
	/** Where the emoticon starts: the whitespace before it stays. */
	start: number;
	/** The caret, after the typed space. */
	end: number;
	emoji: string;
}

/** The emoticon (plus the space just typed) ending `lineBeforeCaret`, or null. */
export function matchEmoticon(lineBeforeCaret: string): EmoticonMatch | null
{
	const match = EMOTICON_RULE.exec(lineBeforeCaret);
	if (match === null) return null;
	const emoji = EMOTICONS[match[2] ?? ""];
	if (emoji === undefined) return null;
	return {
		start: match.index + (match[1] ?? "").length,
		end: lineBeforeCaret.length,
		emoji,
	};
}

/**
 * The textarea form of upstream's input rule: when `next` is `previous` with one space typed at a collapsed `caret`,
 * and that space ends an emoticon on its line, the text with the emoticon swapped for its emoji (the space kept) and
 * the caret after it. A paste or any other edit converts nothing.
 */
export function typedEmoticon(
	previous: string,
	next: string,
	caret: number,
	selectionEnd: number = caret,
):
{
	text: string;
	caret: number;
} | null
{
	if (
		caret !== selectionEnd ||
		next.length !== previous.length + 1 ||
		next.charAt(caret - 1) !== " " ||
		next.slice(0, caret - 1) + next.slice(caret) !== previous
	)
		return null;
	const lineStart = next.lastIndexOf("\n", caret - 1) + 1;
	const match = matchEmoticon(next.slice(lineStart, caret));
	if (match === null) return null;
	const start = lineStart + match.start;
	const inserted = `${match.emoji} `;
	return {
		text: next.slice(0, start) + inserted + next.slice(caret),
		caret: start + inserted.length,
	};
}
