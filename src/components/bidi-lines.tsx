import {useDirection} from "@base-ui/react/direction-provider";

/** Strong right-to-left letters (upstream `FN`). */
export const RTL_LETTER = /[֐-ࣿיִ-﷿ﹰ-﻿\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u;
const BIDI_CONTROL = /\p{Bidi_Control}/u;

/** Upstream's `ra`: the text, byte order marks aside, has a right-to-left letter or a bidi control (`Qv`). */
function hasBidi(text: string): boolean
{
	const bare = text.replaceAll("﻿", "");
	return RTL_LETTER.test(bare) || BIDI_CONTROL.test(bare);
}

/** Upstream's `hz`: one line's class. */
function lineClass(line: string, rtl: boolean): string
{
	if (rtl) return "block whitespace-pre-wrap [overflow-wrap:anywhere] [unicode-bidi:plaintext]";
	return hasBidi(line)
		? "block whitespace-pre-wrap [overflow-wrap:anywhere] [unicode-bidi:inherit]"
		: "block [unicode-bidi:inherit]";
}

/**
 * Upstream's bidi line splitter (shared-38 `VP`, the plain file-change body's `Ca`). Left-to-right text draws as
 * is unless it spans lines and carries right-to-left letters or bidi controls; then, and always under a
 * right-to-left direction, each line is its own block span (`data-code-line-group`) so one line's direction
 * can't reorder the next.
 */
export function BidiLines({children}: {children: string})
{
	const rtl = useDirection() === "rtl";
	if (!rtl && !(children.includes("\n") && hasBidi(children))) return children;
	return children.split(/(?<=\n)/).map((line, index) => (
		// oxlint-disable-next-line react/no-array-index-key -- the lines are fixed for one text
		<span key={index} className={lineClass(line, rtl)} data-code-line-group="">
			{line}
		</span>
	));
}
