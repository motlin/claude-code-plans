import {useSyncExternalStore} from "react";
import {z} from "zod";

/**
 * "Attach as context" (⇧⌘L) as on claude.ai/code: a file, line range or
 * selection becomes an `@path` mention, `@path#L<a>-<b>` for lines, followed
 * by a fenced excerpt when text was selected; terminal output is fenced alone.
 * The Files, Changes and Terminal panes attach through `attachContext`, which
 * queues a removable chip in the session's composer; chips serialize ahead of
 * the prompt on send.
 */

export interface LineRange {
	start: number;
	end: number;
}

export interface AttachContextInput {
	/** Path relative to the working directory, or absolute outside it. */
	path: string;
	range?: LineRange | undefined;
	/** Selected text, attached as a fenced excerpt. */
	text?: string | undefined;
	/** Fence info string, such as "typescript". */
	language?: string | null | undefined;
}

function lineSuffix(range: LineRange | undefined): string {
	if (range === undefined) return "";
	return range.start === range.end ? `#L${range.start}` : `#L${range.start}-${range.end}`;
}

/** A backtick fence longer than any backtick run inside `text`. */
function fenceFor(text: string): string {
	const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
	return "`".repeat(Math.max(3, longestRun + 1));
}

/** `text` in a code fence that its own backticks cannot close. */
function formatFencedExcerpt(text: string, language?: string | null): string {
	const fence = fenceFor(text);
	return `${fence}${language ?? ""}\n${text}\n${fence}`;
}

export function formatAttachContext({path, range, text, language}: AttachContextInput): string {
	const mention = `@${path}${lineSuffix(range)}`;
	if (text === undefined) return mention;
	return `${mention}\n${formatFencedExcerpt(text, language)}`;
}

/** A "Request changes" comment on a line, or a range of lines, of a diff. */
export interface ReviewComment {
	path: string;
	line: number;
	endLine?: number | undefined;
	text: string;
}

/** `path:line — comment`, or `path:start-end — comment` for a range. */
export function formatReviewComment({path, line, endLine, text}: ReviewComment): string {
	const lines = endLine === undefined || endLine === line ? `${line}` : `${line}-${endLine}`;
	return `${path}:${lines} — ${text}`;
}

export function formatReviewComments(comments: readonly ReviewComment[]): string {
	return comments.map(formatReviewComment).join("\n\n");
}

/**
 * Add a snippet to the end of a prompt: a one-line mention joins with a space,
 * a fenced excerpt starts on its own line, and either leaves the caret ready
 * for more typing.
 */
export function appendAttachment(prompt: string, snippet: string): string {
	const multiline = snippet.includes("\n");
	const separator = prompt === "" || /\s$/.test(prompt) ? "" : multiline ? "\n" : " ";
	return `${prompt}${separator}${snippet}${multiline ? "\n" : " "}`;
}

/**
 * What the composer's chip strip holds: ⇧⌘L / "Attach as context" files,
 * folders, selections and terminal output, plus uploaded images and long
 * pastes (⌘U, drop, paste), and transcript messages attached from their
 * context menu, which send as a fenced excerpt like terminal output.
 */
export const ContextAttachmentKindSchema = z.enum(["file", "selection", "terminal", "image", "pasted-text", "message"]);
export type ContextAttachmentKind = z.infer<typeof ContextAttachmentKindSchema>;

export interface ContextAttachment {
	kind: ContextAttachmentKind;
	/**
	 * File or folder mention path; folders end in "/". An image's saved absolute
	 * path. Absent for terminal output and pasted text.
	 */
	path?: string | undefined;
	range?: LineRange | undefined;
	/** The excerpt, fenced on send; pasted text, inlined as is. */
	text?: string | undefined;
	language?: string | null | undefined;
	/** Display name of an uploaded file, whose saved path is a uuid. */
	name?: string | undefined;
	/** Thumbnail source for an image chip. */
	previewUrl?: string | undefined;
}

const LONG_PASTE_CHARS = 2000;
const LONG_PASTE_LINES = 40;

function lineCount(text: string): number {
	return text.split("\n").length;
}

/** Pastes this long become a "Pasted text · N lines" chip instead of prompt text. */
export function isLongPaste(text: string): boolean {
	return text.length > LONG_PASTE_CHARS || lineCount(text) > LONG_PASTE_LINES;
}

export type AttachContextHandler = (attachment: ContextAttachment) => void;

/** A context attachment waiting in the composer's chip strip. */
export interface ContextChip extends ContextAttachment {
	id: string;
}

/**
 * `@path#La-b` plus a fenced excerpt; terminal output is just the fenced text.
 * An image is its saved path, which the CLI attaches, and pasted text is inlined.
 */
export function formatContextAttachment({kind, path, range, text, language}: ContextAttachment): string {
	if (kind === "pasted-text") return text ?? "";
	if (kind === "image" && path !== undefined) return path;
	if (kind === "terminal" || path === undefined) return formatFencedExcerpt(text ?? "");
	return formatAttachContext({path, range, text, language});
}

export function contextChipLabel({kind, path, range, text, name: displayName}: ContextAttachment): string {
	if (kind === "pasted-text") {
		const lines = lineCount(text ?? "");
		return `Pasted text · ${lines} ${lines === 1 ? "line" : "lines"}`;
	}
	if (displayName !== undefined) return displayName;
	if (kind === "message") return "Message";
	if (kind === "terminal" || path === undefined) return "Terminal output";
	const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
	const name = `${trimmed.slice(trimmed.lastIndexOf("/") + 1) || trimmed}${path.endsWith("/") ? "/" : ""}`;
	if (range === undefined) return name;
	return range.start === range.end ? `${name}:${range.start}` : `${name}:${range.start}-${range.end}`;
}

/** Attached context in attach order, then queued review comments, then the prompt. */
export function composePrompt(
	prompt: string,
	context: readonly ContextAttachment[],
	comments: readonly ReviewComment[],
): string {
	const blocks = context.map(formatContextAttachment);
	if (comments.length > 0) blocks.push(formatReviewComments(comments));
	if (prompt !== "") blocks.push(prompt);
	return blocks.join("\n\n");
}

/** A mounted composer: text requests land in its prompt, attachments as chips. */
export interface ComposerHandle {
	insertText: (text: string) => void;
	focus: () => void;
}

const composers = new Map<string, Set<ComposerHandle>>();

let chips = new Map<string, readonly ContextChip[]>();
const chipListeners = new Set<() => void>();
let nextChipId = 1;
const NO_CHIPS: readonly ContextChip[] = [];

function setChips(sessionId: string, next: readonly ContextChip[]): void {
	chips = new Map(chips);
	if (next.length === 0) chips.delete(sessionId);
	else chips.set(sessionId, next);
	for (const listener of chipListeners) listener();
}

function mounted(sessionId: string): readonly ComposerHandle[] {
	return [...(composers.get(sessionId) ?? [])];
}

export function getContextChips(sessionId: string): readonly ContextChip[] {
	return chips.get(sessionId) ?? NO_CHIPS;
}

/**
 * Adds a context chip to the session's composer and focuses it; false, adding
 * nothing, when no composer is mounted for the session.
 */
export function attachContext(sessionId: string, attachment: ContextAttachment): boolean {
	const handles = mounted(sessionId);
	if (handles.length === 0) return false;
	const chip: ContextChip = {...attachment, id: `context-chip-${nextChipId++}`};
	setChips(sessionId, [...getContextChips(sessionId), chip]);
	for (const handle of handles) handle.focus();
	return true;
}

export function removeContextChip(sessionId: string, id: string): void {
	setChips(
		sessionId,
		getContextChips(sessionId).filter((chip) => chip.id !== id),
	);
}

/** Returns the chips and empties the strip, as sending a prompt does. */
export function takeContextChips(sessionId: string): readonly ContextChip[] {
	const taken = getContextChips(sessionId);
	if (taken.length > 0) setChips(sessionId, []);
	return taken;
}

export function useContextChips(sessionId: string): readonly ContextChip[] {
	return useSyncExternalStore(
		(listener) => {
			chipListeners.add(listener);
			return () => chipListeners.delete(listener);
		},
		() => getContextChips(sessionId),
		() => NO_CHIPS,
	);
}

/** Put text, such as a "Fix this" prompt, into the session's prompt; false when no composer is mounted. */
export function requestComposerInsert(sessionId: string, text: string): boolean {
	const handles = mounted(sessionId);
	for (const handle of handles) handle.insertText(text);
	return handles.length > 0;
}

export function registerComposer(sessionId: string, handle: ComposerHandle): () => void {
	const sessionComposers = composers.get(sessionId) ?? new Set();
	sessionComposers.add(handle);
	composers.set(sessionId, sessionComposers);
	return () => {
		sessionComposers.delete(handle);
		if (sessionComposers.size === 0) composers.delete(sessionId);
	};
}
