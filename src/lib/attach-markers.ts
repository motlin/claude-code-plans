/** A context snippet a sent prompt carried as an `<!-- attach -->` quote block. */
export interface AttachSnippet
{
	text: string;
	label?: string;
	terminalTabId?: string;
}

/** Upstream's codec `Ne`: an attach marker line followed by its `> ` quote lines. */
const ATTACH_BLOCK_RE = /^<!-- attach(?:: (.*?))?(?: \| tab:(\S+))? -->\n((?:>(?: |$).*\n?)+)\n*/gm;

function unquote(quote: string): string
{
	return quote
		.split("\n")
		.map((line) => line.replace(/^> ?/, ""))
		.join("\n")
		.trim();
}

/**
 * Upstream's codec `B`: strips each `<!-- attach -->` block into a snippet
 * (dropping empty ones) and returns the trimmed remaining prompt.
 */
export function parseAttachSnippets(text: string):
{
	snippets: AttachSnippet[];
	rest: string;
}
{
	if (!text.includes("<!-- attach"))
		return {
			snippets: [],
			rest: text.trim(),
		};
	const snippets: AttachSnippet[] = [];
	const rest = text.replace(
		ATTACH_BLOCK_RE,
		(_match: string, label: string | undefined, tab: string | undefined, quote: string) =>
		{
			const unquoted = unquote(quote);
			if (unquoted)
			{
				const snippet: AttachSnippet =
				{
					text: unquoted,
				};
				const trimmedLabel = label?.trim();
				if (trimmedLabel) snippet.label = trimmedLabel;
				if (tab) snippet.terminalTabId = tab;
				snippets.push(snippet);
			}
			return "";
		},
	);
	return {
		snippets,
		rest: rest.trim(),
	};
}

/** One piece of a reply-led prompt after its lead quote: a later block's quote, or body text still holding attach blocks. */
export interface ReplyPart
{
	kind: "quote" | "text";
	text: string;
}

/** A prompt sent from upstream's inline reply card: the quote it replies to, then its later quotes and bodies in order. */
export interface ReplyLead
{
	replyQuote: string | null;
	parts: ReplyPart[];
}

/** Upstream's `M`: the single `<!-- reply -->` lead with its quote lines. */
const SINGLE_REPLY_RE = /^<!-- reply -->\n((?:>(?: |$).*\n?)+)\n*/;
/** Upstream's `we`: the `<!-- reply N -->` lead of a staged multi-reply prompt. */
const NUMBERED_REPLY_RE = /^<!-- reply ([1-9][0-9]?) -->\n(?=> |>$)/;
/** Upstream's `N`: a sticky run of quote lines. */
const QUOTE_RUN_RE = /(?:>(?: |$).*\n?)+/y;
/** Upstream's `P`: where a later block's `<!-- reply -->` marker begins. */
const LATER_BLOCK = "\n\n<!-- reply -->\n>";
const LATER_MARKER_LENGTH = "<!-- reply -->\n".length;

interface ReplyBlock
{
	quote: string;
	bodyStart: number;
	bodyEnd: number;
}

/** Upstream's `F`: the blocks of a `<!-- reply N -->` lead and where the prompt after them starts. */
function parseNumberedReply(text: string):
{
	blocks: ReplyBlock[];
	restStart: number;
} | null
{
	const lead = NUMBERED_REPLY_RE.exec(text);
	if (lead === null) return null;
	const count = Number(lead[1]);
	const blocks: ReplyBlock[] = [];
	let quoteStart = lead[0].length;
	let restBreak = -2;
	for (;;)
	{
		QUOTE_RUN_RE.lastIndex = quoteStart;
		const run = QUOTE_RUN_RE.exec(text);
		if (run === null) return null;
		const runEnd = quoteStart + run[0].length;
		const quoteEnd = text.charCodeAt(runEnd - 1) === 10 ? runEnd - 1 : runEnd;
		let bodyStart = runEnd;
		while (text.charCodeAt(bodyStart) === 10) bodyStart++;
		if (bodyStart - quoteEnd >= 3)
		{
			blocks.push(
				{
					quote: unquote(run[0]),
					bodyStart: quoteEnd,
					bodyEnd: quoteEnd,
				},
			);
			return {
				blocks,
				restStart: quoteEnd + 3,
			};
		}
		if (restBreak !== -1 && restBreak < bodyStart) restBreak = text.indexOf("\n\n\n", bodyStart);
		const limit = restBreak === -1 ? text.length : restBreak;
		let next = -1;
		if (blocks.length + 1 < count)
		{
			for (
				let at = text.indexOf(LATER_BLOCK, bodyStart);
				at !== -1 && at < limit;
				at = text.indexOf(LATER_BLOCK, at + 1)
			)
			{
				QUOTE_RUN_RE.lastIndex = at + LATER_BLOCK.length - 1;
				if (QUOTE_RUN_RE.test(text))
				{
					next = at;
					break;
				}
			}
		}
		blocks.push(
			{
				quote: unquote(run[0]),
				bodyStart,
				bodyEnd: next === -1 ? limit : next,
			},
		);
		if (next === -1)
			return {
				blocks,
				restStart: restBreak === -1 ? text.length : restBreak + 3,
			};
		quoteStart = next + 2 + LATER_MARKER_LENGTH;
	}
}

/**
 * Upstream's reply segmenting (`V` for a single `<!-- reply -->` lead, `it` over `F` for `<!-- reply N -->`):
 * the first block's quote becomes the bubble's reply quote, later quotes stay inline between their bodies.
 * Text parts are untrimmed and may still hold `<!-- attach -->` blocks. Null when the prompt has no reply lead.
 */
export function parseReplyLead(text: string): ReplyLead | null
{
	if (text.startsWith("<!-- reply -->\n>"))
	{
		const single = SINGLE_REPLY_RE.exec(text);
		if (single === null) return null;
		return {
			replyQuote: unquote(single[1] ?? "") || null,
			parts: textParts(text.slice(single[0].length)),
		};
	}
	if (!text.startsWith("<!-- reply")) return null;
	const numbered = parseNumberedReply(text);
	if (numbered === null) return null;
	let replyQuote: string | null = null;
	const parts: ReplyPart[] = [];
	numbered.blocks.forEach((block, index) =>
	{
		if (block.quote !== "")
		{
			if (index === 0) replyQuote = block.quote;
			else
				parts.push(
					{
						kind: "quote",
						text: block.quote,
					},
				);
		}
		parts.push(...textParts(text.slice(block.bodyStart, block.bodyEnd)));
	});
	parts.push(...textParts(text.slice(numbered.restStart)));
	return {
		replyQuote,
		parts,
	};
}

function textParts(text: string): ReplyPart[]
{
	return text.trim() === ""
		? []
		: [
				{
					kind: "text",
					text,
				},
			];
}
