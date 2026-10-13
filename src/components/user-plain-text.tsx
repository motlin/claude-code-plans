import type {ReactNode} from "react";

import {defined} from "../lib/defined";

const PARAGRAPH_CLASS = "text-body whitespace-pre-wrap [overflow-wrap:anywhere]";

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

function linkify(text: string, keyPrefix: number): ReactNode[] {
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
				rel="noopener noreferrer"
				className="text-link"
			>
				{url}
			</a>,
		);
		cursor = match.index + url.length;
	}
	if (cursor < text.length) nodes.push(text.slice(cursor));
	return nodes;
}

function renderInline(text: string): ReactNode[] {
	const nodes: ReactNode[] = [];
	let cursor = 0;
	for (const match of text.matchAll(CODE_SPAN)) {
		if (match.index > cursor) nodes.push(...linkify(text.slice(cursor, match.index), cursor));
		nodes.push(
			<code key={match.index} className={CODE_CLASS}>
				{match[2]}
			</code>,
		);
		cursor = match.index + match[0].length;
	}
	if (cursor < text.length) nodes.push(...linkify(text.slice(cursor), cursor));
	return nodes;
}

/** Upstream's list: a 6px-gap column of items whose text starts 20px in, the marker hanging in that padding. */
const LIST_CLASS = "text-body flex flex-col gap-[6px] ps-5 [&>li]:whitespace-pre-wrap [&>li]:[overflow-wrap:anywhere]";

/** Spacing between a bubble's blocks, as upstream's 5px-gap markdown root spaces them. */
const BLOCK_GAP_CLASS = "mt-[5px]";

const ORDERED_ITEM = /^ {0,3}(\d{1,9})[.)][ \t]+(.*)$/;
const BULLET_ITEM = /^ {0,3}([-*+])[ \t]+(.*)$/;

interface ListItemStart {
	ordered: boolean;
	/** The ordered list's number, or the bullet character. */
	marker: string;
	text: string;
}

function listItemStart(line: string): ListItemStart | null {
	const ordered = ORDERED_ITEM.exec(line);
	if (ordered !== null)
		return {
			ordered: true,
			marker: defined(ordered[1], "ORDERED_ITEM has a number group"),
			text: defined(ordered[2], "ORDERED_ITEM has a text group"),
		};
	const bullet = BULLET_ITEM.exec(line);
	if (bullet !== null)
		return {
			ordered: false,
			marker: defined(bullet[1], "BULLET_ITEM has a bullet group"),
			text: defined(bullet[2], "BULLET_ITEM has a text group"),
		};
	return null;
}

function sameList(a: ListItemStart, b: ListItemStart): boolean {
	return a.ordered === b.ordered && (a.ordered || a.marker === b.marker);
}

type Block = {kind: "text"; text: string} | {kind: "list"; ordered: boolean; start: number; items: string[]};

/**
 * Split a prompt into runs of literal text and the lists upstream lifts out of
 * it. A list starts at a line opening with "1." or "-" (a paragraph line may
 * only be interrupted by an ordered list that starts at 1, as in CommonMark)
 * and runs while its lines are items of the same list or their continuations.
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
		const first = listItemStart(head);
		const afterText = (textLines.at(-1)?.trim() ?? "") !== "";
		if (first === null || (afterText && first.ordered && first.marker !== "1")) {
			textLines.push(head);
			i++;
			continue;
		}
		flushText();
		const items = [first.text];
		i++;
		for (let line = lines[i]; line !== undefined; line = lines[i]) {
			const item = listItemStart(line);
			if (item !== null) {
				if (!sameList(first, item)) break;
				items.push(item.text);
				i++;
				continue;
			}
			if (line.trim() === "") {
				const next = lines.slice(i).find((candidate) => candidate.trim() !== "");
				const nextItem = next === undefined ? null : listItemStart(next);
				if (nextItem === null || !sameList(first, nextItem)) break;
				i++;
				continue;
			}
			items[items.length - 1] += `\n${line.trim()}`;
			i++;
		}
		while (lines[i]?.trim() === "") i++;
		blocks.push({kind: "list", ordered: first.ordered, start: first.ordered ? Number(first.marker) : 1, items});
	}
	flushText();
	return blocks;
}

/**
 * A user prompt as upstream shows it: its lists drawn as lists, the rest kept as
 * typed. Other markdown syntax stays literal; only backtick code spans (plus an
 * optional leading slash-command chip) are styled and bare http(s) URLs outside
 * code spans become accent links.
 */
export function UserPlainText({text, prefix}: {text: string; prefix?: ReactNode}) {
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
				const items = block.items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item)}</li>);
				return block.ordered ? (
					<ol
						key={index}
						start={block.start === 1 ? undefined : block.start}
						className={`list-decimal ${LIST_CLASS} ${gap}`}
					>
						{items}
					</ol>
				) : (
					<ul key={index} className={`list-disc ${LIST_CLASS} ${gap}`}>
						{items}
					</ul>
				);
			})}
		</>
	);
}
