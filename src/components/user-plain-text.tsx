import {lazy, type ReactNode, Suspense} from "react";

import {defined} from "../lib/defined";

const PARAGRAPH_CLASS = "text-body whitespace-pre-wrap [overflow-wrap:anywhere] text-pretty [unicode-bidi:plaintext]";

const CODE_CLASS =
	"font-mono text-[12px]/[12px] text-code-ink bg-alpha-1 border-[0.5px] border-border rounded-[4.8px] px-[3px] py-[0.75px]";

/** A backtick run, its content, and the same-length closing run (CommonMark code span delimiters). */
const CODE_SPAN = /(?<!`)(`+)(?!`)([\s\S]+?)(?<!`)\1(?!`)/g;

const URL_PATTERN = /https?:\/\/[^\s<>`]+/g;

/** Trailing sentence punctuation, and a closing paren with no opener inside the URL, are not part of it. */
function trimUrl(url: string): string {
	let end = url.length;
	for (;;) {
		const last = url[end - 1];
		if (last !== undefined && ".,;:!?'\"]".includes(last)) end--;
		else if (last === ")" && url.slice(0, end).split("(").length < url.slice(0, end).split(")").length) end--;
		else return url.slice(0, end);
	}
}

/** How a linked URL is drawn: a user message's accent link, or upstream's TextLink (`dir="ltr"`, `rel="noreferrer"`). */
type LinkStyle = "user" | "textLink";

function linkify(text: string, keyPrefix: number, style: LinkStyle = "user"): ReactNode[] {
	const nodes: ReactNode[] = [];
	let cursor = 0;
	for (const match of text.matchAll(URL_PATTERN)) {
		const url = trimUrl(match[0]);
		if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
		nodes.push(
			<a
				key={`${keyPrefix}-${match.index}`}
				href={url}
				target="_blank"
				{...(style === "textLink"
					? {rel: "noreferrer", dir: "ltr", className: "text-link inline cursor-pointer"}
					: {rel: "noopener noreferrer", className: "text-link"})}
			>
				{url}
			</a>,
		);
		cursor = match.index + url.length;
	}
	if (cursor < text.length) nodes.push(text.slice(cursor));
	return nodes;
}

/**
 * A user message's inline paint without its block layout, its URLs as upstream's
 * TextLink. Upstream's question card header passes `codeSpans={false}` to keep
 * backticks literal.
 */
export function UserInlineText({text, codeSpans = true}: {text: string; codeSpans?: boolean}) {
	return <>{codeSpans ? renderInline(text, "textLink") : linkify(text, 0, "textLink")}</>;
}

function renderInline(text: string, style: LinkStyle = "user"): ReactNode[] {
	const nodes: ReactNode[] = [];
	let cursor = 0;
	for (const match of text.matchAll(CODE_SPAN)) {
		if (match.index > cursor) nodes.push(...linkify(text.slice(cursor, match.index), cursor, style));
		nodes.push(
			<code key={match.index} className={CODE_CLASS}>
				{match[2]}
			</code>,
		);
		cursor = match.index + match[0].length;
	}
	if (cursor < text.length) nodes.push(...linkify(text.slice(cursor), cursor, style));
	return nodes;
}

/** Upstream's list: a 6px-gap column of items whose text starts 20px in, the marker hanging in that padding. */
const LIST_CLASS =
	"text-body flex flex-col gap-[6px] ps-5 text-pretty [&>li]:whitespace-pre-wrap [&>li]:[overflow-wrap:anywhere]";

/** Spacing between a bubble's blocks, as upstream's 5px-gap markdown root spaces them. */
const BLOCK_GAP_CLASS = "mt-[5px]";

/** Upstream's list items: "* " or a canonical "N. ", indented in 3-space steps (a bare marker only on the last line). */
const BULLET_ITEM = /^((?: {3})*)\*(?: (.*))?$/;
const ORDERED_ITEM = /^((?: {3})*)(\d+)\.(?: (.*))?$/;

interface ListEntry {
	level: number;
	ordered: boolean;
	/** The ordered item's number. */
	start: number;
	text: string;
}

function listEntry(line: string, isLast: boolean): ListEntry | null {
	const bullet = BULLET_ITEM.exec(line);
	if (bullet !== null && (bullet[2] !== undefined || isLast)) {
		return {level: (bullet[1] ?? "").length / 3, ordered: false, start: 1, text: bullet[2] ?? ""};
	}
	const ordered = ORDERED_ITEM.exec(line);
	const number = ordered?.[2];
	if (ordered === null || number === undefined || String(Number(number)) !== number) return null;
	if (ordered[3] === undefined && !isLast) return null;
	return {level: (ordered[1] ?? "").length / 3, ordered: true, start: Number(number), text: ordered[3] ?? ""};
}

type Block = {kind: "text"; text: string} | {kind: "list"; entries: ListEntry[]};

/**
 * Split a prompt into runs of literal text and the lists upstream lifts out of
 * it (its `ccd_user_message_lists_main` parser). A list starts with a top-level
 * item at the start of the prompt or after a blank line, never straight after
 * text; it takes deeper items and continuation lines, and ends at a blank line.
 */
function splitBlocks(text: string): Block[] {
	const lines = text.split("\n");
	const blocks: Block[] = [];
	let textLines: string[] = [];
	const flushText = () => {
		while (textLines.at(-1)?.trim() === "") textLines.pop();
		if (textLines.length > 0) blocks.push({kind: "text", text: textLines.join("\n")});
		textLines = [];
	};
	let i = 0;
	for (let head = lines[i]; head !== undefined; head = lines[i]) {
		const first = listEntry(head, i === lines.length - 1);
		const afterText = (textLines.at(-1)?.trim() ?? "") !== "";
		if (first?.level !== 0 || afterText) {
			textLines.push(head);
			i++;
			continue;
		}
		flushText();
		const entries = [first];
		i++;
		for (let line = lines[i]; line !== undefined && line.trim() !== ""; line = lines[i]) {
			const entry = listEntry(line, i === lines.length - 1);
			if (entry === null) {
				const last = defined(entries.at(-1), "a list has its first entry");
				last.text += `\n${line.trim()}`;
			} else {
				const parent = entries.at(-1)?.level ?? 0;
				entries.push({...entry, level: Math.min(entry.level, parent + 1)});
			}
			i++;
		}
		while (lines[i]?.trim() === "") i++;
		blocks.push({kind: "list", entries});
	}
	flushText();
	return blocks;
}

/** Runs of same-kind sibling entries at `level`, each with the deeper entries under it. */
function renderList(entries: readonly ListEntry[], level: number, className: string, key: number): ReactNode[] {
	const lists: ReactNode[] = [];
	let index = 0;
	while (index < entries.length) {
		const head = defined(entries[index], "index is in range");
		const items: ReactNode[] = [];
		while (index < entries.length) {
			const entry = defined(entries[index], "index is in range");
			if (entry.level !== level || entry.ordered !== head.ordered) break;
			let end = index + 1;
			while (end < entries.length && defined(entries[end], "end is in range").level > level) end++;
			items.push(
				<li key={index}>
					{renderInline(entry.text)}
					{renderList(entries.slice(index + 1, end), level + 1, "", index)}
				</li>,
			);
			index = end;
		}
		const listKey = `${key}-${level}-${lists.length}`;
		lists.push(
			head.ordered ? (
				<ol
					key={listKey}
					start={head.start === 1 ? undefined : head.start}
					className={`list-decimal ${LIST_CLASS} ${className}`}
				>
					{items}
				</ol>
			) : (
				<ul key={listKey} className={`list-disc ${LIST_CLASS} ${className}`}>
					{items}
				</ul>
			),
		);
	}
	return lists;
}

const UserCodeBlock = lazy(async () => import("./user-code-block").then((module) => ({default: module.UserCodeBlock})));

/**
 * Upstream's user-message fence: a column-0 run of 3+ backticks with a spaceless
 * info string, closed by the same run alone on its line. An unclosed fence stays text.
 */
const FENCE = /^(`{3,})(\S*)\n([\s\S]*?)\n\1[ \t]*$/gm;

type Segment = {kind: "text"; text: string} | {kind: "code"; code: string; lang: string};

/** Split out the fences, trimming the text between them, as upstream does before parsing lists. */
function splitFences(text: string): Segment[] {
	const segments: Segment[] = [];
	let cursor = 0;
	const pushText = (part: string) => {
		const trimmed = part.trim();
		if (trimmed !== "") segments.push({kind: "text", text: trimmed});
	};
	for (const match of text.matchAll(FENCE)) {
		pushText(text.slice(cursor, match.index));
		const code = (match[3] ?? "").replace(/\r?\n$/, "").replace(/\r(?!\n)/g, "\u240d");
		const info = match[2] ?? "";
		segments.push({kind: "code", code, lang: info === "" ? "text" : info});
		cursor = match.index + match[0].length;
	}
	pushText(text.slice(cursor));
	return segments;
}

/**
 * A user prompt as upstream shows it: ``` fences as code snippets, lists in the
 * text between them drawn as lists, the rest kept as typed.
 */
export function UserPlainText({text, prefix}: {text: string; prefix?: ReactNode}) {
	const segments = text.includes("```") ? splitFences(text) : [];
	if (!segments.some((segment) => segment.kind === "code")) return <UserTextBlocks text={text} prefix={prefix} />;
	const prefixed = segments[0]?.kind === "text";
	return (
		<>
			{!prefixed && prefix !== undefined && <p className={PARAGRAPH_CLASS}>{prefix}</p>}
			{segments.map((segment, index) => {
				const gap = index > 0 || (!prefixed && prefix !== undefined) ? BLOCK_GAP_CLASS : "";
				if (segment.kind === "text") {
					return (
						<div key={index} className={`flex flex-col ${gap}`}>
							<UserTextBlocks text={segment.text} prefix={index === 0 ? prefix : undefined} />
						</div>
					);
				}
				return (
					<div
						key={index}
						data-user-code-block={segment.lang}
						className={`epitaxy-diff overflow-clip rounded-r4 ${gap}`}
					>
						<Suspense
							fallback={
								<pre className="font-mono text-[12px]/[17px] whitespace-pre-wrap">{segment.code}</pre>
							}
						>
							<UserCodeBlock code={segment.code} lang={segment.lang} />
						</Suspense>
					</div>
				);
			})}
		</>
	);
}

/**
 * Text as upstream shows it: its lists drawn as lists, the rest kept as typed.
 * Other markdown syntax stays literal; only backtick code spans (plus an
 * optional leading slash-command chip) are styled and bare http(s) URLs outside
 * code spans become accent links.
 */
function UserTextBlocks({text, prefix}: {text: string; prefix?: ReactNode}) {
	const blocks = splitBlocks(text);
	if (!blocks.some((block) => block.kind === "list")) {
		return (
			<p className={PARAGRAPH_CLASS}>
				{prefix}
				{prefix !== undefined && text !== "" && " "}
				{renderInline(text)}
			</p>
		);
	}
	const leadingPrefix = prefix !== undefined && blocks[0]?.kind === "list";
	return (
		<>
			{leadingPrefix && <p className={PARAGRAPH_CLASS}>{prefix}</p>}
			{blocks.map((block, index) => {
				const gap = index > 0 || leadingPrefix ? BLOCK_GAP_CLASS : "";
				if (block.kind === "text") {
					return (
						<p key={index} className={`${PARAGRAPH_CLASS} ${gap}`}>
							{index === 0 && prefix}
							{index === 0 && prefix !== undefined && " "}
							{renderInline(block.text)}
						</p>
					);
				}
				return renderList(block.entries, 0, gap, index);
			})}
		</>
	);
}
