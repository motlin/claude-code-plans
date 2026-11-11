import {Fragment, lazy, type ReactNode, Suspense} from "react";

import {defined} from "../lib/defined";
import {BIDI_CONTROLS, MARKDOWN_LINK, markdownLinkTarget, SLACK_TOKEN} from "../lib/markdown-link";
import {pageIsRtl} from "../lib/page-direction";
import {maskSecrets, maskUrlSecrets} from "../lib/secret-mask";
import {revealSpoofing} from "../lib/visible-text";
import {CloakedText} from "./cloaked-text";
import {trimUrl} from "./linkify-plain";
import {UserCodeSpan} from "./user-code-span";

/** Upstream's user paragraph: `text-body` rewritten to `text-prose`, then `[unicode-bidi:plaintext]` appended. */
export const USER_PARAGRAPH_CLASS =
	"text-prose whitespace-pre-wrap [overflow-wrap:anywhere] text-pretty [unicode-bidi:plaintext]";

/** Upstream's single-backtick code span (`W` in c8a6d9da5): no backtick runs, never across a line. */
const CODE_SPAN = /`([^`\n]+)`/g;

const URL_PATTERN = /https?:\/\/[^\s<>`]+/g;

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
					? {rel: "noreferrer", dir: "ltr", className: "cds-reset text-link inline cursor-pointer"}
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
 * Upstream's question-text code chip (`rounded-chip bg-alpha-1 px-xs text-code-regular`), where
 * `rounded-chip` is a quarter of --cds-h-control-nested (5.5px comfortable).
 */
const CODE_CHIP_CLASS =
	"rounded-[calc(var(--cds-h-control-nested)/4)] bg-alpha-1 px-xs font-mono text-code font-normal";

/** How an inline code span is drawn: a user message's code span, or upstream's question-text chip. */
type CodeLook = "message" | "chip";

interface UserInlineTextProps {
	text: string;
	/** False keeps backticks literal (an option description). */
	codeSpans?: boolean;
	codeLook?: CodeLook;
	/** False leaves URLs as plain text, as upstream's Asked row body. */
	links?: boolean;
	/**
	 * Upstream's question header paint (c2f6611a3 `Zt`, `revealCloaks`): the raw text unmasked, its runs shown
	 * through `u9` with each secret cloaked behind its own reveal button. Chip look only.
	 */
	revealCloaks?: boolean;
}

/**
 * A user message's inline paint without its block layout, its URLs as upstream's
 * TextLink. Upstream's question card header draws code spans as its chip and `**text**` bold (`codeLook="chip"`).
 */
export function UserInlineText({
	text: raw,
	codeSpans = true,
	codeLook = "message",
	links = true,
	revealCloaks = false,
}: UserInlineTextProps) {
	if (revealCloaks && codeLook === "chip") return <>{chipText(raw, cloakPaint)}</>;
	const text = maskSecrets(raw);
	const plain = (part: string, at: number): ReactNode[] => (links ? linkify(part, at, "textLink") : [part]);
	if (!codeSpans) return <>{plain(text, 0)}</>;
	if (codeLook === "message") return <>{renderInline(text, "textLink")}</>;
	return <>{chipText(text, links ? plain : undefined)}</>;
}

/** Upstream's question-text code span (`h` in c8a73d209): any backtick-free run, newlines included. */
const CHIP_CODE_SPAN = /`[^`]+`/g;

interface ChipPart {
	text: string;
	isCode: boolean;
}

/** Upstream's `j` (c8a73d209): the text split into code spans (backticks dropped) and the runs between. */
function chipCodeParts(text: string): ChipPart[] {
	const parts: ChipPart[] = [];
	let cursor = 0;
	for (const match of text.matchAll(CHIP_CODE_SPAN)) {
		if (match.index > cursor) parts.push({text: text.slice(cursor, match.index), isCode: false});
		parts.push({text: match[0].slice(1, -1), isCode: true});
		cursor = match.index + match[0].length;
	}
	if (cursor < text.length) parts.push({text: text.slice(cursor), isCode: false});
	return parts.length > 0 ? parts : [{text, isCode: false}];
}

/** Upstream's `po`: a single-line code span, or a `**` run whose inner text neither starts nor ends with space or `*`. */
const CHIP_MARKUP = /(`[^`\n]+`|\*\*[^\s*](?:[^*\n]*[^\s*])?\*\*)/;
/** Upstream's `mo`: a `**` run flanked by one of these stays literal. */
const BOLD_FLANK = /[\p{L}\p{N}/*]/u;

interface BoldPart {
	text: string;
	bold: boolean;
}

/** Upstream's `ho` (c59c32499): bold runs split out with their `**` dropped; a double backtick anywhere disables both. */
function boldParts(text: string): BoldPart[] {
	if (text.includes("``")) return [{text, bold: false}];
	return text.split(CHIP_MARKUP).map((part, index, parts) => {
		const bold =
			index % 2 === 1 &&
			part.startsWith("**") &&
			!BOLD_FLANK.test(parts[index - 1]?.at(-1) ?? "") &&
			!BOLD_FLANK.test(parts[index + 1]?.[0] ?? "");
		return {text: bold ? part.slice(2, -2) : part, bold};
	});
}

/** Upstream's `uo`: the text as read, code backticks dropped. */
function chipPlainText(text: string): string {
	return text.includes("``")
		? text
		: chipCodeParts(text)
				.map((part) => part.text)
				.join("");
}

type Paint = (part: string, at: number) => ReactNode[];

/** Upstream's `ja` (cf6507c5a): an http(s) URL the `yr` paint links. */
const PAINT_URL = /https?:\/\/[^\s<>"]+/g;

/** Upstream's TextLink anchor (`m` rendering an `a`), as `pr` draws a live link. */
function TextLink({href, children}: {href: string; children: ReactNode}) {
	return (
		<a href={href} target="_blank" rel="noreferrer" dir="ltr" className="cds-reset text-link inline cursor-pointer">
			{children}
		</a>
	);
}

/** Upstream's `Qn` (cbb72cde9): the pill `tr` draws a Slack-style token in. */
const TOKEN_PILL_CLASS =
	"inline-flex items-center px-0.75 rounded-full bg-alpha-1 font-medium [overflow-wrap:anywhere]";

/**
 * Upstream's `yr` (cbb72cde9) as the question header's `Zt` calls it (c2f6611a3): `revealCloaks` and
 * model-authored, with no people mentions, session mentions or conversation links passed. First Slack-style
 * `<@…>` / `<#…>` tokens as `tr` pills, then `[label](url)` markdown links as TextLinks whose label is the
 * non-interactive cloak paint in a `bdi` with the host disclosed (`_r`), then bare URLs as TextLinks drawn as
 * `u9` of their masked form (`$2`); every other run cloaked.
 */
const cloakPaint: Paint = (part, at) => {
	const pieces = (from: number, to: number) => cloakPaint(part.slice(from, to), at + from);
	if (part.includes("<@") || part.includes("<#")) {
		const nodes: ReactNode[] = [];
		let cursor = 0;
		for (const match of part.matchAll(SLACK_TOKEN)) {
			if (match.index > cursor) nodes.push(...pieces(cursor, match.index));
			nodes.push(
				<span key={`${at}-s${match.index}`} dir={pageIsRtl() ? "auto" : undefined} className={TOKEN_PILL_CLASS}>
					{match[1]}
					<CloakedText text={match[3] ?? match[2] ?? ""} />
				</span>,
			);
			cursor = match.index + match[0].length;
		}
		if (cursor > 0) {
			if (cursor < part.length) nodes.push(...pieces(cursor, part.length));
			return nodes;
		}
	}
	if (part.includes("](")) {
		const nodes: ReactNode[] = [];
		let cursor = 0;
		for (const match of part.matchAll(MARKDOWN_LINK)) {
			if (match.index > cursor) nodes.push(...pieces(cursor, match.index));
			const label = (match[1] ?? "").replace(BIDI_CONTROLS, "");
			const target = markdownLinkTarget(label, match[2] ?? "");
			nodes.push(
				target.kind === "plain" ? (
					<CloakedText key={`${at}-m${match.index}`} text={match[0]} />
				) : (
					<TextLink key={`${at}-m${match.index}`} href={target.href}>
						<bdi>
							<CloakedText text={label} nonInteractive />
						</bdi>
						{target.discloseHost !== null && (
							<span dir="ltr" className="opacity-70">{` (\u2192 ${target.discloseHost})`}</span>
						)}
					</TextLink>
				),
			);
			cursor = match.index + match[0].length;
		}
		if (cursor > 0) {
			if (cursor < part.length) nodes.push(...pieces(cursor, part.length));
			return nodes;
		}
	}
	if (!part.includes("://")) return [<CloakedText key={`${at}-t`} text={part} />];
	const nodes: ReactNode[] = [];
	let cursor = 0;
	for (const match of part.matchAll(PAINT_URL)) {
		const url = trimUrl(match[0]);
		if (match.index > cursor)
			nodes.push(<CloakedText key={`${at}-t${cursor}`} text={part.slice(cursor, match.index)} />);
		nodes.push(
			<TextLink key={`${at}-u${match.index}`} href={url}>
				{revealSpoofing(maskUrlSecrets(url))}
			</TextLink>,
		);
		cursor = match.index + url.length;
	}
	if (cursor < part.length) nodes.push(<CloakedText key={`${at}-t${cursor}`} text={part.slice(cursor)} />);
	return nodes;
};

/** Upstream's `lo`: the text as is. */
const unpainted: Paint = (part) => [part];

/** Upstream's `fo`: code spans as its chip, the rest painted. */
function chipCode(text: string, paint: Paint, key: string): ReactNode[] {
	if (text.includes("``")) return paint(text, 0);
	return chipCodeParts(text).map((part, index) =>
		part.isCode ? (
			<code key={`${key}-${index}`} dir="ltr" className={CODE_CHIP_CLASS}>
				{part.text}
			</code>
		) : (
			<Fragment key={`${key}-${index}`}>{paint(part.text, 0)}</Fragment>
		),
	);
}

/**
 * Upstream's `_i` (`vo` in c59c32499): `**text**` as `strong.font-medium` with code chips inside, the
 * rest as `fo`. Without a paint, when masking the read text (markup dropped) hides a secret the markup
 * split, the masked read text is drawn unstyled. With a paint, when `u9` of the masked read text differs
 * from the read text, the read text itself (unmasked) is painted unstyled.
 */
function chipText(text: string, paint: Paint | undefined): ReactNode[] {
	const parts = boldParts(text);
	const read = parts.map((part) => chipPlainText(part.text)).join("");
	const masked = maskSecrets(read);
	if (paint === undefined && masked !== read) return [masked];
	if (paint !== undefined && revealSpoofing(masked) !== read) return paint(read, 0);
	const painter = paint ?? unpainted;
	return parts.map((part, index) =>
		part.bold ? (
			<strong key={index} className="font-medium">
				{chipCode(part.text, painter, String(index))}
			</strong>
		) : (
			<Fragment key={index}>{chipCode(part.text, painter, String(index))}</Fragment>
		),
	);
}

function renderInline(text: string, style: LinkStyle = "user", nonInteractive = false): ReactNode[] {
	const nodes: ReactNode[] = [];
	let cursor = 0;
	for (const match of text.matchAll(CODE_SPAN)) {
		if (match.index > cursor) nodes.push(...linkify(text.slice(cursor, match.index), cursor, style));
		nodes.push(<UserCodeSpan key={match.index} text={match[1] ?? ""} nonInteractive={nonInteractive} />);
		cursor = match.index + match[0].length;
	}
	if (cursor < text.length) nodes.push(...linkify(text.slice(cursor), cursor, style));
	return nodes;
}

/** Upstream's list: a 6px-gap column of items whose text starts 20px in, the marker hanging in that padding. */
const LIST_CLASS =
	"text-body flex flex-col gap-[6px] ps-5 text-pretty [&>li]:whitespace-pre-wrap [&>li]:[overflow-wrap:anywhere]";

/**
 * Upstream's user text root: `div[data-testid=user-message]` grid > the 5px-gap block column that spaces a
 * prompt's paragraphs, lists and code snippets.
 */
function UserMessageText({children}: {children: ReactNode}) {
	return (
		<div data-testid="user-message" className="relative grid min-w-0 grid-cols-1 gap-2">
			<div className="flex min-w-0 flex-col gap-1.25">{children}</div>
		</div>
	);
}

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
function renderList(entries: readonly ListEntry[], level: number, key: number, nonInteractive: boolean): ReactNode[] {
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
					{renderInline(entry.text, "user", nonInteractive)}
					{renderList(entries.slice(index + 1, end), level + 1, index, nonInteractive)}
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
					className={`list-decimal ${LIST_CLASS}`}
				>
					{items}
				</ol>
			) : (
				<ul key={listKey} className={`list-disc ${LIST_CLASS}`}>
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

interface UserTextProps {
	text: string;
	prefix?: ReactNode;
	/** Upstream's `nonInteractive` (queued or pending prompts): code spans never become file links. */
	nonInteractive?: boolean;
}

/**
 * A user prompt as upstream shows it: ``` fences as code snippets, lists in the
 * text between them drawn as lists, the rest kept as typed.
 */
export function UserPlainText({text, prefix, nonInteractive = false}: UserTextProps) {
	// Upstream (c59c32499) masks secrets in a user turn with plain `XF`: no reveal control.
	return (
		<UserMessageText>
			<UserPlainBlocks text={maskSecrets(text)} prefix={prefix} nonInteractive={nonInteractive} />
		</UserMessageText>
	);
}

function UserPlainBlocks({text, prefix, nonInteractive = false}: UserTextProps) {
	const segments = text.includes("```") ? splitFences(text) : [];
	if (!segments.some((segment) => segment.kind === "code"))
		return <UserTextBlocks text={text} prefix={prefix} nonInteractive={nonInteractive} />;
	const prefixed = segments[0]?.kind === "text";
	return (
		<>
			{!prefixed && prefix !== undefined && <p className={USER_PARAGRAPH_CLASS}>{prefix}</p>}
			{segments.map((segment, index) => {
				if (segment.kind === "text") {
					return (
						<div key={index} className="flex flex-col gap-1.25">
							<UserTextBlocks
								text={segment.text}
								prefix={index === 0 ? prefix : undefined}
								nonInteractive={nonInteractive}
							/>
						</div>
					);
				}
				return (
					<div
						key={index}
						data-user-code-block={segment.lang}
						className="epitaxy-diff overflow-clip rounded-r4"
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
function UserTextBlocks({text, prefix, nonInteractive = false}: UserTextProps) {
	const blocks = splitBlocks(text);
	if (!blocks.some((block) => block.kind === "list")) {
		return (
			<p className={USER_PARAGRAPH_CLASS}>
				{prefix}
				{prefix !== undefined && text !== "" && " "}
				{renderInline(text, "user", nonInteractive)}
			</p>
		);
	}
	const leadingPrefix = prefix !== undefined && blocks[0]?.kind === "list";
	return (
		<>
			{leadingPrefix && <p className={USER_PARAGRAPH_CLASS}>{prefix}</p>}
			{blocks.map((block, index) => {
				if (block.kind === "text") {
					return (
						<p key={index} className={USER_PARAGRAPH_CLASS}>
							{index === 0 && prefix}
							{index === 0 && prefix !== undefined && " "}
							{renderInline(block.text, "user", nonInteractive)}
						</p>
					);
				}
				return renderList(block.entries, 0, index, nonInteractive);
			})}
		</>
	);
}
