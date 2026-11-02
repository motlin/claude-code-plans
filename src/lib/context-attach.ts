import {useMemo, useSyncExternalStore} from "react";
import {z} from "zod";

import type {ToastOptions} from "../components/toast-context";
import {storeRejectedDraft} from "../hooks/use-composer-draft";
import {MAX_ATTACHMENT_BYTES, uploadAttachment} from "./api/attachments";
import {type QueuedDiffComment, restoreQueuedDiffComments} from "./diff-comments";
import {mergeRefill} from "./send-rejection";

/**
 * "Attach as context" (⇧⌘L) as on claude.ai/code: a file, line range or
 * selection becomes an `@path` mention, `@path#L<a>-<b>` for lines, followed
 * by a fenced excerpt when text was selected; terminal output is fenced alone.
 * The Files, Changes and Terminal panes attach through `attachContext`, which
 * queues a removable chip in the session's composer; chips serialize ahead of
 * the prompt on send.
 */

export interface LineRange
{
	start: number;
	end: number;
}

export interface AttachContextInput
{
	/** Path relative to the working directory, or absolute outside it. */
	path: string;
	range?: LineRange | undefined;
	/** Selected text, attached as a fenced excerpt. */
	text?: string | undefined;
	/** Fence info string, such as "typescript". */
	language?: string | null | undefined;
}

function lineSuffix(range: LineRange | undefined): string
{
	if (range === undefined) return "";
	return range.start === range.end ? `#L${range.start}` : `#L${range.start}-${range.end}`;
}

/** A backtick fence longer than any backtick run inside `text`. */
function fenceFor(text: string): string
{
	const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
	return "`".repeat(Math.max(3, longestRun + 1));
}

/** `text` in a code fence that its own backticks cannot close. */
function formatFencedExcerpt(text: string, language?: string | null): string
{
	const fence = fenceFor(text);
	return `${fence}${language ?? ""}\n${text}\n${fence}`;
}

export function formatAttachContext({path, range, text, language}: AttachContextInput): string
{
	const mention = `@${path}${lineSuffix(range)}`;
	if (text === undefined) return mention;
	return `${mention}\n${formatFencedExcerpt(text, language)}`;
}

/** A diff comment on a line, or a range of lines, of a diff. */
export interface ReviewComment
{
	path: string;
	/** "deletions" comments on the old side, serialized as "(before changes)". */
	side?: "additions" | "deletions" | undefined;
	line: number;
	endLine?: number | undefined;
	text: string;
	/** The commented lines' text, sent as a fenced block under the header. */
	snippet?: string | undefined;
	/** The snippet fence's info string, such as "typescript". */
	lang?: string | undefined;
}

/** Upstream `jl`: a path that can't break the header line or its backtick quoting. */
function headerPath(path: string): string
{
	return path.replace(/[\r\n\u2028\u2029]+/g, " ").replace(/`/g, "'");
}

/** One comment as upstream's `In \`path\` at line N:` header, fenced snippet and body. */
function formatDiffAnnotation({path, side, line, endLine, text, snippet, lang}: ReviewComment): string
{
	const lines = endLine === undefined || endLine === line ? `line ${line}` : `lines ${line}-${endLine}`;
	const parts = [`In \`${headerPath(path)}\` at ${lines}${side === "deletions" ? " (before changes)" : ""}:`];
	if (snippet !== undefined) parts.push(formatFencedExcerpt(snippet, lang));
	parts.push(text.replace(/\n{3,}/g, "\n\n"));
	return parts.join("\n");
}

/**
 * Upstream's diff-annotation serializer `dl`: comments grouped by file in first-seen order and sorted by
 * line, blocks joined by a blank line, then `\n\n\n` and the prompt when there is one.
 */
export function formatDiffAnnotations(comments: readonly ReviewComment[], prompt: string): string
{
	if (comments.length === 0) return prompt;
	const byPath = new Map<string, ReviewComment[]>();
	for (const comment of comments) byPath.set(comment.path, [...(byPath.get(comment.path) ?? []), comment]);
	const blocks = [...byPath.values()].flatMap((group) =>
		group.toSorted((a, b) => a.line - b.line).map(formatDiffAnnotation),
	);
	const annotations = blocks.join("\n\n");
	return prompt === "" ? annotations : `${annotations}\n\n\n${prompt}`;
}

/**
 * Add a snippet to the end of a prompt: a one-line mention joins with a space,
 * a fenced excerpt starts on its own line, and either leaves the caret ready
 * for more typing.
 */
export function appendAttachment(prompt: string, snippet: string): string
{
	const multiline = snippet.includes("\n");
	const separator = prompt === "" || /\s$/.test(prompt) ? "" : multiline ? "\n" : " ";
	return `${prompt}${separator}${snippet}${multiline ? "\n" : " "}`;
}

/**
 * What the composer's chip strip holds: ⇧⌘L / "Attach as context" files,
 * folders, selections and terminal output, plus uploaded images (⌘U, drop,
 * paste), transcript messages attached from their
 * context menu, which send as a fenced excerpt like terminal output, and
 * transcript text selections, which send as upstream's "Excerpt" snippet,
 * and ⌘K Compose pastes of 500+ chars, which send inline as is.
 */
export const ContextAttachmentKindSchema = z.enum([
	"file",
	"selection",
	"terminal",
	"image",
	"message",
	"excerpt",
	"pasted-text",
]);
export type ContextAttachmentKind = z.infer<typeof ContextAttachmentKindSchema>;

export interface ContextAttachment
{
	kind: ContextAttachmentKind;
	/**
	 * File or folder mention path; folders end in "/". An image's saved absolute
	 * path. Absent for terminal output.
	 */
	path?: string | undefined;
	range?: LineRange | undefined;
	/** The excerpt, fenced on send. */
	text?: string | undefined;
	language?: string | null | undefined;
	/** Display name of an uploaded file, whose saved path is a uuid. */
	name?: string | undefined;
	/** Thumbnail source for an image chip. */
	previewUrl?: string | undefined;
	/** An uploaded file's bytes, kept in memory so its tile can preview text. */
	file?: File | undefined;
	/** Still uploading: shown as a pending tile and left out of a send. */
	status?: "pending" | undefined;
}

export type AttachContextHandler = (attachment: ContextAttachment) => void;

/** A context attachment waiting in the composer's chip strip. */
export interface ContextChip extends ContextAttachment
{
	id: string;
}

/**
 * Upstream's unlabeled snippet wire format (codec `w(e)`): an attach marker,
 * then every line of the text quoted, splitting on CR, LF, CRLF, U+2028 and U+2029.
 */
function formatExcerpt(text: string): string
{
	const quoted = text.split(/\r\n?|[\n\u2028\u2029]/).map((line) => `> ${line}`);
	return `<!-- attach -->\n${quoted.join("\n")}`;
}

/**
 * `@path#La-b` plus a fenced excerpt; terminal output is just the fenced text.
 * An image is its saved path, which the CLI attaches. A transcript excerpt is
 * upstream's `<!-- attach -->` quote block. Pasted text is inlined.
 */
export function formatContextAttachment({kind, path, range, text, language}: ContextAttachment): string
{
	if (kind === "pasted-text") return text ?? "";
	if (kind === "excerpt") return formatExcerpt(text ?? "");
	if (kind === "image" && path !== undefined) return path;
	if (kind === "terminal" || path === undefined) return formatFencedExcerpt(text ?? "");
	return formatAttachContext(
		{
			path,
			range,
			text,
			language,
		},
	);
}

export function contextChipLabel({kind, path, range, text, name: displayName}: ContextAttachment): string
{
	if (kind === "pasted-text")
	{
		const lines = (text ?? "").split("\n").length;
		return `Pasted text · ${lines} ${lines === 1 ? "line" : "lines"}`;
	}
	if (displayName !== undefined) return displayName;
	if (kind === "message") return "Message";
	if (kind === "excerpt") return "Excerpt";
	if (kind === "terminal" || path === undefined) return "Terminal output";
	const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
	const name = `${trimmed.slice(trimmed.lastIndexOf("/") + 1) || trimmed}${path.endsWith("/") ? "/" : ""}`;
	if (range === undefined) return name;
	return range.start === range.end ? `${name}:${range.start}` : `${name}:${range.start}-${range.end}`;
}

/** Queued diff comments first (upstream `dl`), then attached context in attach order, then the prompt. */
export function composePrompt(
	prompt: string,
	context: readonly ContextAttachment[],
	comments: readonly ReviewComment[],
): string
{
	const blocks = context.map(formatContextAttachment);
	if (prompt !== "") blocks.push(prompt);
	return formatDiffAnnotations(comments, blocks.join("\n\n"));
}

/** A mounted composer: text requests land in its prompt, attachments as chips. */
export interface ComposerHandle
{
	insertText: (text: string) => void;
	focus: () => void;
	/** Replaces the prompt text and focuses; absent, with getText, where no send can be rejected. */
	setText?: (text: string) => void;
	getText?: () => string;
	/** Runs the composer's Enter path on its current text; absent where no send can be rejected. */
	submit?: () => void;
	/**
	 * Puts a cancelled steer back, ahead of any draft, and focuses; false when refused (a command in bash mode).
	 * Absent where steers can't be sent.
	 */
	takeBack?: (text: string) => boolean;
	/**
	 * Upstream's session prefill (`Gh`): appends text at the end of the draft and focuses; false, adding
	 * nothing, when refused (bash mode, or a command in the draft).
	 */
	prefill?: (text: string) => boolean;
}

const composers = new Map<string, Set<ComposerHandle>>();

let chips = new Map<string, readonly ContextChip[]>();
const chipListeners = new Set<() => void>();
let nextChipId = 1;
const NO_CHIPS: readonly ContextChip[] = [];

function setChips(sessionId: string, next: readonly ContextChip[]): void
{
	chips = new Map(chips);
	if (next.length === 0) chips.delete(sessionId);
	else chips.set(sessionId, next);
	saveStagedChips(sessionId, next);
	for (const listener of chipListeners) listener();
}

const STAGED_CHIPS_PREFIX = "ccp-composer-attachments:";

/** What a reload can bring back of a tile: no bytes, no blob preview, nothing still uploading. */
const StagedChipSchema = z.object(
	{
		kind: ContextAttachmentKindSchema,
		path: z.string().optional(),
		range: z
			.object(
				{
					start: z.number(),
					end: z.number(),
				},
			)
			.optional(),
		text: z.string().optional(),
		language: z.string().nullable().optional(),
		name: z.string().optional(),
	},
);
type StagedChip = z.infer<typeof StagedChipSchema>;

function browserLocalStorage(): Storage | null
{
	if (typeof window === "undefined") return null;
	try
	{
		return window.localStorage;
	}
	catch
	{
		return null;
	}
}

function stagedChip({kind, path, range, text, language, name}: ContextChip): StagedChip
{
	return {
		kind,
		...(path !== undefined &&
		{
			path,
		}),
		...(range !== undefined &&
		{
			range,
		}),
		...(text !== undefined &&
		{
			text,
		}),
		...(language !== undefined &&
		{
			language,
		}),
		...(name !== undefined &&
		{
			name,
		}),
	};
}

/** Upstream saves staged attachments with the draft (`stagedImages`); settled tiles only, as their bytes stay in memory. */
function saveStagedChips(sessionId: string, next: readonly ContextChip[]): void
{
	try
	{
		const storage = browserLocalStorage();
		if (storage === null) return;
		const key = `${STAGED_CHIPS_PREFIX}${sessionId}`;
		const settled = next.filter((chip) => chip.status !== "pending").map(stagedChip);
		if (settled.length === 0) storage.removeItem(key);
		else storage.setItem(key, JSON.stringify(settled));
	}
	catch
	{
		// Saved tiles are best-effort: storage can be denied or full.
	}
}

function readStagedChips(sessionId: string): readonly StagedChip[]
{
	try
	{
		const raw = browserLocalStorage()?.getItem(`${STAGED_CHIPS_PREFIX}${sessionId}`);
		if (raw === null || raw === undefined) return [];
		const parsed = z.array(StagedChipSchema).safeParse(JSON.parse(raw));
		return parsed.success ? parsed.data : [];
	}
	catch
	{
		return [];
	}
}

/** Ids of tiles put back from storage: upstream's restored tiles, which skip the enter motion. */
const restoredIds = new Set<string>();

function restoredChip(attachment: ContextAttachment): ContextChip
{
	const id = `context-chip-${nextChipId++}`;
	restoredIds.add(id);
	return {
		...attachment,
		id,
	};
}

/**
 * Brings back the session's tiles saved before a reload, with a served preview
 * for images; false, changing nothing, when the strip already holds tiles or
 * nothing was saved.
 */
export function hydrateStagedChips(sessionId: string): boolean
{
	if (getContextChips(sessionId).length > 0) return false;
	const saved = readStagedChips(sessionId);
	if (saved.length === 0) return false;
	const restored = saved.map((chip) =>
		restoredChip(
			{
				...chip,
				...(chip.kind === "image" &&
					chip.path !== undefined &&
					{
						previewUrl: `/api/image?path=${encodeURIComponent(chip.path)}`,
					}),
			},
		),
	);
	setChips(sessionId, restored);
	for (const chip of restored)
	{
		if (chip.kind === "image" && chip.previewUrl !== undefined) dropIfGone(sessionId, chip.id, chip.previewUrl);
	}
	return true;
}

/**
 * Drops a restored image tile, silently, once its saved file turns out to be
 * gone, as upstream skips a stored image it can't use; a failed check keeps it.
 */
function dropIfGone(sessionId: string, id: string, previewUrl: string): void
{
	fetch(
		previewUrl,
		{
			method: "HEAD",
		},
	).then(
		(response) =>
		{
			if (response.status === 404 || response.status === 403) removeContextChip(sessionId, id);
		},
		() =>
		{
			// Offline or interrupted: the file may well still be there.
		},
	);
}

interface SentAttachments
{
	prompt: string;
	/** The typed text alone, without tiles or comments. */
	text: string;
	chips: readonly ContextChip[];
	comments: readonly QueuedDiffComment[];
}

/** Recent sends that carried tiles or diff comments, per session, so a rejection or take-back can put them back. */
const sentAttachments = new Map<string, readonly SentAttachments[]>();
const MAX_SENT_ATTACHMENTS = 10;

/**
 * Remembers the tiles and diff comments a send carried, keyed by the composed prompt it sent; a send with
 * neither records nothing.
 */
export function recordSentAttachments(
	sessionId: string,
	prompt: string,
	text: string,
	sent: readonly ContextChip[],
	comments: readonly QueuedDiffComment[] = [],
): void
{
	if (sent.length === 0 && comments.length === 0) return;
	const recent = (sentAttachments.get(sessionId) ?? []).filter((each) => each.prompt !== prompt);
	sentAttachments.set(
		sessionId,
		[
			...recent,
			{
				prompt,
				text,
				chips: sent,
				comments,
			},
		].slice(-MAX_SENT_ATTACHMENTS),
	);
}

function findSent(sessionId: string, prompt: string): SentAttachments | undefined
{
	return sentAttachments.get(sessionId)?.find((each) => each.prompt === prompt);
}

/** Puts a recorded send's tiles and comments back and forgets the record. */
function restoreSent(sessionId: string, match: SentAttachments, notify?: (options: ToastOptions) => void): void
{
	sentAttachments.set(
		sessionId,
		(sentAttachments.get(sessionId) ?? []).filter((each) => each !== match),
	);
	appendRestoredChips(sessionId, match.chips, notify);
	if (match.comments.length > 0) restoreQueuedDiffComments(sessionId, match.comments);
}

/**
 * Upstream's `addImageFiles`/`addFileAttachments` on a give-back: the tiles are appended as fresh adds (new
 * ids, so they play the enter motion), images only while the 5-image cap has room, with one warning toast.
 */
function appendRestoredChips(
	sessionId: string,
	restored: readonly ContextChip[],
	notify?: (options: ToastOptions) => void,
): void
{
	if (restored.length === 0) return;
	const current = getContextChips(sessionId);
	let room = MAX_IMAGES - current.filter((chip) => chip.kind === "image").length;
	const fresh: ContextChip[] = [];
	for (const {id: _id, ...chip} of restored)
	{
		if (chip.kind === "image")
		{
			if (room <= 0) continue;
			room--;
		}
		fresh.push(
			{
				...chip,
				id: `context-chip-${nextChipId++}`,
			},
		);
	}
	if (fresh.length < restored.length)
		notify?.(
			{
				kind: "warning",
				message: MAX_IMAGES_MESSAGE,
				durationMs: ATTACH_WARNING_MS,
			},
		);
	setChips(sessionId, [...current, ...fresh]);
}

/**
 * Upstream's composer restore after a rejected send (changelog cb63ed069): the tiles the prompt carried are
 * appended to the strip, its diff comments go back in the queue, and the typed text comes back; null when
 * the prompt carried neither tiles nor comments.
 */
export function restoreRejectedAttachments(
	sessionId: string,
	prompt: string,
	notify?: (options: ToastOptions) => void,
): string | null
{
	const match = findSent(sessionId, prompt);
	if (match === undefined) return null;
	restoreSent(sessionId, match, notify);
	return match.text;
}

/**
 * Upstream's take-back (held withdraw, cancelled steer, Esc recall): the composer gets the typed text and
 * the tiles come back; false, keeping the record and adding nothing, when the composer refuses it.
 */
export function takeBackSend(sessionId: string, prompt: string, notify?: (options: ToastOptions) => void): boolean
{
	const match = findSent(sessionId, prompt);
	if (!requestComposerTakeBack(sessionId, match?.text ?? prompt)) return false;
	if (match !== undefined) restoreSent(sessionId, match, notify);
	return true;
}

function mounted(sessionId: string): readonly ComposerHandle[]
{
	return [...(composers.get(sessionId) ?? [])];
}

/** Whether a composer is mounted for the session, so attachments have somewhere to land. */
export function hasComposer(sessionId: string): boolean
{
	return (composers.get(sessionId)?.size ?? 0) > 0;
}

export function getContextChips(sessionId: string): readonly ContextChip[]
{
	return chips.get(sessionId) ?? NO_CHIPS;
}

/**
 * Adds a context chip to the session's composer and focuses it; false, adding
 * nothing, when no composer is mounted for the session.
 */
export function attachContext(sessionId: string, attachment: ContextAttachment): boolean
{
	return addChip(sessionId, attachment) !== undefined;
}

function addChip(sessionId: string, attachment: ContextAttachment): string | undefined
{
	const handles = mounted(sessionId);
	if (handles.length === 0) return undefined;
	const chip: ContextChip =
	{
		...attachment,
		id: `context-chip-${nextChipId++}`,
	};
	setChips(sessionId, [...getContextChips(sessionId), chip]);
	for (const handle of handles) handle.focus();
	return chip.id;
}

/** Adds a pending tile for an upload in flight; its id, or undefined when no composer is mounted. */
export function attachPendingUpload(sessionId: string, attachment: ContextAttachment): string | undefined
{
	return addChip(
		sessionId,
		{
			...attachment,
			status: "pending",
		},
	);
}

/** Swaps a pending tile for the saved attachment in place; false when it was removed meanwhile. */
export function resolvePendingUpload(sessionId: string, id: string, attachment: ContextAttachment): boolean
{
	const current = getContextChips(sessionId);
	if (!current.some((chip) => chip.id === id)) return false;
	setChips(
		sessionId,
		current.map((chip) =>
			chip.id === id
				?
					{
						...attachment,
						id,
					}
				: chip,
		),
	);
	return true;
}

/** Keeps a restored tile's fetched bytes on it in place, so its preview opens without another fetch; false when it was removed meanwhile. */
export function cacheChipFile(sessionId: string, id: string, file: File): boolean
{
	const current = getContextChips(sessionId);
	if (!current.some((chip) => chip.id === id)) return false;
	setChips(
		sessionId,
		current.map((chip) =>
			chip.id === id
				?
					{
						...chip,
						file,
					}
				: chip,
		),
	);
	return true;
}

/** Removes a pending tile whose upload failed. */
export function dropPendingUpload(sessionId: string, id: string): void
{
	removeContextChip(sessionId, id);
}

export function removeContextChip(sessionId: string, id: string): void
{
	setChips(
		sessionId,
		getContextChips(sessionId).filter((chip) => chip.id !== id),
	);
}

/** Returns the settled chips and removes them from the strip, as sending a prompt does; pending uploads stay. */
export function takeContextChips(sessionId: string): readonly ContextChip[]
{
	const current = getContextChips(sessionId);
	const taken = current.filter((chip) => chip.status !== "pending");
	if (taken.length > 0)
		setChips(
			sessionId,
			current.filter((chip) => chip.status === "pending"),
		);
	return taken;
}

/** Resolves once none of the session's chips is still uploading, as upstream's `waitForImagesReady`. */
export async function waitForPendingUploads(sessionId: string): Promise<void>
{
	const settled = () => !getContextChips(sessionId).some((chip) => chip.status === "pending");
	if (settled()) return;
	await new Promise<void>((resolve) =>
	{
		const listener = () =>
		{
			if (!settled()) return;
			chipListeners.delete(listener);
			resolve();
		};
		chipListeners.add(listener);
	});
}

/**
 * The ids of the chips already staged when the composer mounted for this
 * session: upstream's restored tiles, which skip the enter motion. The strip
 * itself mounts with the first new chip, so it can't tell on its own.
 */
export function useRestoredChipIds(sessionId: string): ReadonlySet<string>
{
	const current = useContextChips(sessionId);
	const atMount = useMemo(() => new Set(getContextChips(sessionId).map((chip) => chip.id)), [sessionId]);
	return useMemo(
		() => new Set([...atMount, ...current.filter((chip) => restoredIds.has(chip.id)).map((chip) => chip.id)]),
		[atMount, current],
	);
}

export function useContextChips(sessionId: string): readonly ContextChip[]
{
	return useSyncExternalStore(
		(listener) =>
		{
			chipListeners.add(listener);
			return () => chipListeners.delete(listener);
		},
		() => getContextChips(sessionId),
		() => NO_CHIPS,
	);
}

/** Put text, such as a "Fix this" prompt, into the session's prompt; false when no composer is mounted. */
export function requestComposerInsert(sessionId: string, text: string): boolean
{
	const handles = mounted(sessionId);
	for (const handle of handles) handle.insertText(text);
	return handles.length > 0;
}

/** Upstream's `requestComposerAction` after a keyboard comment save: focus the composer, or send its prompt. */
export function requestComposerAction(sessionId: string, action: "focus" | "submit"): boolean
{
	return action === "submit" ? submitComposer(sessionId) : focusComposer(sessionId);
}

/** Upstream's local take-back join: the cancelled message, a blank line, then the draft. */
export function mergeTakeBack(text: string, draft: string): string
{
	return draft.trim() === "" ? text : `${text}\n\n${draft}`;
}

/** Puts a cancelled steer back into the session's composer; false when none takes it. */
export function requestComposerTakeBack(sessionId: string, text: string): boolean
{
	let taken = false;
	for (const handle of mounted(sessionId))
	{
		if (handle.takeBack?.(text) === true) taken = true;
	}
	return taken;
}

/** Puts a rejected prompt back into the session's first composer, above anything typed meanwhile; false when none is mounted. */
export function refillComposer(sessionId: string, text: string): boolean
{
	const handle = mounted(sessionId).find((each) => each.setText !== undefined && each.getText !== undefined);
	if (handle?.setText === undefined || handle.getText === undefined) return false;
	if (text !== "") handle.setText(mergeRefill(text, handle.getText()));
	return true;
}

/** What a rejected send put back: with tiles or comments, the prompt can't be resent as is (upstream `nonResendable`). */
export interface RejectedRefill
{
	restoredAttachments: boolean;
}

/**
 * Puts a rejected send back: its tiles, comments and typed text when it carried any, else the prompt as
 * text. With no composer mounted for the session, the text goes above the session's stored draft
 * (upstream's off-screen `restoreDraftStash`).
 */
export function refillRejectedSend(
	sessionId: string,
	prompt: string,
	notify?: (options: ToastOptions) => void,
): RejectedRefill
{
	const text = restoreRejectedAttachments(sessionId, prompt, notify);
	const refill = text ?? prompt;
	if (!refillComposer(sessionId, refill) && refill !== "") storeRejectedDraft(sessionId, refill);
	return {
		restoredAttachments: text !== null,
	};
}

/** The session's first composer's prompt text, or null when none can report it. */
export function getComposerText(sessionId: string): string | null
{
	return (
		mounted(sessionId)
			.find((each) => each.getText !== undefined)
			?.getText?.() ?? null
	);
}

/** Submits the session's first composer as Enter would; false when none can submit. */
export function submitComposer(sessionId: string): boolean
{
	const handle = mounted(sessionId).find((each) => each.submit !== undefined);
	handle?.submit?.();
	return handle !== undefined;
}

/** Focuses the session's composer; false when no composer is mounted. */
export function focusComposer(sessionId: string): boolean
{
	const handles = mounted(sessionId);
	for (const handle of handles) handle.focus();
	return handles.length > 0;
}

const composerListeners = new Set<() => void>();

function notifyComposers(): void
{
	for (const listener of composerListeners) listener();
}

export function registerComposer(sessionId: string, handle: ComposerHandle): () => void
{
	const sessionComposers = composers.get(sessionId) ?? new Set();
	sessionComposers.add(handle);
	composers.set(sessionId, sessionComposers);
	notifyComposers();
	return () =>
	{
		sessionComposers.delete(handle);
		if (sessionComposers.size === 0) composers.delete(sessionId);
		notifyComposers();
	};
}

/** Whether a composer is mounted for the session, re-rendering as composers mount and unmount. */
export function useHasComposer(sessionId: string): boolean
{
	return useSyncExternalStore(
		(listener) =>
		{
			composerListeners.add(listener);
			return () => composerListeners.delete(listener);
		},
		() => hasComposer(sessionId),
		() => false,
	);
}

/**
 * Upstream's prefill join (`C8`): the text goes at the end of the draft with no separator, except one
 * space when the draft ends in an @mention token that has none after it.
 */
export function joinPrefill(draft: string, text: string): string
{
	const spaced = /(?:^|\s)@\S*$/.test(draft) && !/^\s/.test(text);
	return `${draft}${spaced ? " " : ""}${text}`;
}

/** Hands text to the session's first composer that takes a prefill; false when none is mounted or it refused. */
export function prefillComposer(sessionId: string, text: string): boolean
{
	const handle = mounted(sessionId).find((each) => each.prefill !== undefined);
	return handle?.prefill?.(text) ?? false;
}

/** Upstream epitaxy's failed-image toast copy (`Ie`). */
const IMAGE_UPLOAD_FAILED = "Failed to process image. You can try again.";

/** Upstream's failed-file toast copy (CCR `Te`), the closest Claude Code string for a file. */
function fileUploadFailedMessage(name: string): string
{
	return `Failed to upload ${name}. It won’t be attached.`;
}

/** Upstream's image cap (`maxImages ?? 5` in epitaxy `Ie`). */
const MAX_IMAGES = 5;

const MAX_IMAGES_MESSAGE = `Maximum of ${MAX_IMAGES} images allowed.`;

/** Upstream's oversize sentence (`Ie`) with the local server's limit in place of its 30 MB. */
const IMAGES_TOO_LARGE_MESSAGE = `Some images were too large to attach. Maximum size is ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB.`;

/** Upstream's warning toast timeout (`Qr`): the size and count warnings last 8 s. */
const ATTACH_WARNING_MS = 8000;

/** Upstream's image lane types (`Yt`); any other file, BMP or SVG included, goes to the file lane. */
const IMAGE_TYPES: ReadonlySet<string> = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

function isImageType(mediaType: string): boolean
{
	return IMAGE_TYPES.has(mediaType);
}

function isImage(file: File): boolean
{
	return isImageType(file.type);
}

/**
 * Upstream's image pre-checks: drops images over the size limit, then any
 * past the 5-image cap (staged and pending chips included), with one warning
 * toast per check. Other files pass through uncounted.
 */
function withinImageCaps(
	sessionId: string,
	files: readonly File[],
	notify: (options: ToastOptions) => void,
): readonly File[]
{
	const sized = files.filter((file) => !isImage(file) || file.size <= MAX_ATTACHMENT_BYTES);
	if (sized.length < files.length)
		notify(
			{
				kind: "warning",
				message: IMAGES_TOO_LARGE_MESSAGE,
				durationMs: ATTACH_WARNING_MS,
			},
		);
	let room = MAX_IMAGES - getContextChips(sessionId).filter((chip) => chip.kind === "image").length;
	const accepted: File[] = [];
	for (const file of sized)
	{
		if (!isImage(file)) accepted.push(file);
		else if (room > 0)
		{
			room--;
			accepted.push(file);
		}
	}
	if (accepted.length < sized.length)
		notify(
			{
				kind: "warning",
				message: MAX_IMAGES_MESSAGE,
				durationMs: ATTACH_WARNING_MS,
			},
		);
	return accepted;
}

/**
 * Uploads files (⌘U, drop, paste) and adds each as an image or file chip in
 * the composer's strip; a failed upload removes its pending chip and raises
 * an error toast through `notify`. Oversize images and images past the cap
 * are dropped with a warning toast first.
 */
export function attachUploadedFiles(
	sessionId: string,
	files: readonly File[],
	notify: (options: ToastOptions) => void,
): void
{
	for (const file of withinImageCaps(sessionId, files, notify))
	{
		const image = isImage(file);
		const previewUrl = image && typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : undefined;
		const id = attachPendingUpload(
			sessionId,
			{
				kind: image ? "image" : "file",
				name: file.name,
				...(previewUrl === undefined
					? {}
					:
						{
							previewUrl,
						}),
			},
		);
		const revokePreview = () =>
		{
			if (previewUrl !== undefined && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(previewUrl);
		};
		uploadAttachment(file).then(
			(saved) =>
			{
				const savedImage = isImageType(saved.mediaType);
				const attachment: ContextAttachment =
				{
					kind: savedImage ? "image" : "file",
					path: saved.path,
					name: saved.name,
				};
				if (savedImage)
				{
					const url =
						previewUrl ??
						(typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : undefined);
					if (url !== undefined) attachment.previewUrl = url;
				}
				if (!savedImage)
				{
					revokePreview();
					attachment.file = file;
				}
				if (id === undefined) attachContext(sessionId, attachment);
				else if (!resolvePendingUpload(sessionId, id, attachment)) revokePreview();
			},
			() =>
			{
				if (id !== undefined) dropPendingUpload(sessionId, id);
				revokePreview();
				notify(
					{
						kind: "error",
						message: image ? IMAGE_UPLOAD_FAILED : fileUploadFailedMessage(file.name),
					},
				);
			},
		);
	}
}
