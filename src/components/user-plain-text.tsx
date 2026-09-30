import type {ReactNode} from "react";

const PARAGRAPH_CLASS = "text-body leading-[1.2857] whitespace-pre-wrap [overflow-wrap:anywhere]";

const CODE_CLASS =
	"font-mono text-[12px]/[12px] text-code-ink bg-alpha-1 border-[0.5px] border-border rounded-[4.8px] px-[3px] py-[0.75px]";

/** A backtick run, its content, and the same-length closing run (CommonMark code span delimiters). */
const CODE_SPAN = /(?<!`)(`+)(?!`)([\s\S]+?)(?<!`)\1(?!`)/g;

function renderInline(text: string): ReactNode[] {
	const nodes: ReactNode[] = [];
	let cursor = 0;
	for (const match of text.matchAll(CODE_SPAN)) {
		if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
		nodes.push(
			<code key={match.index} className={CODE_CLASS}>
				{match[2]}
			</code>,
		);
		cursor = match.index + match[0].length;
	}
	if (cursor < text.length) nodes.push(text.slice(cursor));
	return nodes;
}

/**
 * A user prompt exactly as typed, as upstream shows it: markdown syntax stays literal and only
 * backtick code spans (plus an optional leading slash-command chip) are styled.
 */
export function UserPlainText({text, prefix}: {text: string; prefix?: ReactNode}) {
	return (
		<p className={PARAGRAPH_CLASS}>
			{prefix}
			{prefix !== undefined && text !== "" && " "}
			{renderInline(text)}
		</p>
	);
}
