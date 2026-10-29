import {useSyncExternalStore} from "react";

import type {ReviewComment} from "./context-attach";

/**
 * Comments on Changes pane diff lines, per session. An open comment card is a draft; Save comment queues it, and
 * the session's composer sends the queued comments with its next prompt. Saved comments persist per browser in
 * `localStorage["diff-annotations"]`, as upstream's zustand `persist`; drafts and edit text stay in memory.
 */

export type DiffSide = "additions" | "deletions";

export interface DiffCommentTarget {
	path: string;
	side: DiffSide;
	/** First commented line; the card sits under `endLine ?? line`. */
	line: number;
	endLine?: number | undefined;
}

export interface DiffCommentDraft extends DiffCommentTarget {
	id: string;
}

export interface QueuedDiffComment extends DiffCommentDraft, ReviewComment {}

export interface DiffComments {
	drafts: readonly DiffCommentDraft[];
	queued: readonly QueuedDiffComment[];
}

/**
 * The in-memory editing state beside the comments, as upstream's `bodiesBySession`, `editBodiesBySession`
 * and `activeBySession`: draft and edit text survive their card unmounting, and the active card draws the
 * accent border (a saved comment is open for editing while it is active).
 */
export interface DiffCommentEditing {
	bodies: Readonly<Record<string, string>>;
	editBodies: Readonly<Record<string, string>>;
	activeId: string | null;
}

const EMPTY: DiffComments = {drafts: [], queued: []};
const NO_EDITING: DiffCommentEditing = {bodies: {}, editBodies: {}, activeId: null};

/** Upstream's persist key; the stored shape is `{version: 0, state: {commentsBySession}}`. */
const DIFF_COMMENTS_STORAGE_KEY = "diff-annotations";

const ID_PREFIX = "diff-comment-";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads one stored comment, or undefined when it is malformed (hand-checked to keep zod out of the client bundle). */
function readStoredComment(value: unknown): QueuedDiffComment | undefined {
	if (!isRecord(value)) return undefined;
	const {id, path, side, line, endLine, text} = value;
	if (typeof id !== "string" || typeof path !== "string" || typeof text !== "string") return undefined;
	if ((side !== "additions" && side !== "deletions") || typeof line !== "number") return undefined;
	if (endLine !== undefined && typeof endLine !== "number") return undefined;
	return endLine === undefined ? {id, path, side, line, text} : {id, path, side, line, endLine, text};
}

function readStored(value: unknown): Map<string, DiffComments> | undefined {
	if (!isRecord(value) || value["version"] !== 0 || !isRecord(value["state"])) return undefined;
	const bySession = value["state"]["commentsBySession"];
	if (!isRecord(bySession)) return undefined;
	const restored = new Map<string, DiffComments>();
	for (const [sessionId, stored] of Object.entries(bySession)) {
		if (!Array.isArray(stored)) return undefined;
		const queued: QueuedDiffComment[] = [];
		for (const item of stored) {
			const comment = readStoredComment(item);
			if (comment === undefined) return undefined;
			queued.push(comment);
		}
		if (queued.length > 0) restored.set(sessionId, {drafts: [], queued});
	}
	return restored;
}

let sessions = new Map<string, DiffComments>();
let editing = new Map<string, DiffCommentEditing>();
const listeners = new Set<() => void>();
let nextId = 1;
let hydrated = false;

function hydrate(): void {
	if (hydrated) return;
	hydrated = true;
	try {
		const raw = localStorage.getItem(DIFF_COMMENTS_STORAGE_KEY);
		if (raw === null) return;
		const restored = readStored(JSON.parse(raw));
		if (restored === undefined) return;
		for (const {queued} of restored.values()) {
			for (const {id} of queued) {
				const n = id.startsWith(ID_PREFIX) ? Number(id.slice(ID_PREFIX.length)) : Number.NaN;
				if (Number.isInteger(n) && n >= nextId) nextId = n + 1;
			}
		}
		sessions = restored;
	} catch {
		// Unreadable storage or a corrupt value starts empty.
	}
}

function persist(): void {
	const commentsBySession: Record<string, readonly QueuedDiffComment[]> = {};
	for (const [sessionId, {queued}] of sessions) if (queued.length > 0) commentsBySession[sessionId] = queued;
	try {
		localStorage.setItem(DIFF_COMMENTS_STORAGE_KEY, JSON.stringify({version: 0, state: {commentsBySession}}));
	} catch {
		// Storage full or blocked: comments stay in memory for this page.
	}
}

function update(sessionId: string, change: (comments: DiffComments) => DiffComments): void {
	const before = getDiffComments(sessionId);
	const next = change(before);
	sessions = new Map(sessions);
	if (next.drafts.length === 0 && next.queued.length === 0) sessions.delete(sessionId);
	else sessions.set(sessionId, next);
	if (next.queued !== before.queued) persist();
	for (const listener of listeners) listener();
}

function updateEditing(sessionId: string, change: (state: DiffCommentEditing) => DiffCommentEditing): void {
	const next = change(getDiffCommentEditing(sessionId));
	editing = new Map(editing);
	if (Object.keys(next.bodies).length === 0 && Object.keys(next.editBodies).length === 0 && next.activeId === null)
		editing.delete(sessionId);
	else editing.set(sessionId, next);
	for (const listener of listeners) listener();
}

/** Drops a draft's text and clears the active card when it was this one. */
function forgetDraft(sessionId: string, id: string): void {
	updateEditing(sessionId, ({bodies, editBodies, activeId}) => {
		const {[id]: _dropped, ...rest} = bodies;
		return {bodies: rest, editBodies, activeId: activeId === id ? null : activeId};
	});
}

/** Drops a saved comment's edit text and clears the active card when it was this one. */
function forgetEdit(sessionId: string, id: string): void {
	updateEditing(sessionId, ({bodies, editBodies, activeId}) => {
		const {[id]: _dropped, ...rest} = editBodies;
		return {bodies, editBodies: rest, activeId: activeId === id ? null : activeId};
	});
}

function sameTarget(a: DiffCommentTarget, b: DiffCommentTarget): boolean {
	return (
		a.path === b.path && a.side === b.side && a.line === b.line && (a.endLine ?? a.line) === (b.endLine ?? b.line)
	);
}

export function getDiffComments(sessionId: string): DiffComments {
	hydrate();
	return sessions.get(sessionId) ?? EMPTY;
}

export function getDiffCommentEditing(sessionId: string): DiffCommentEditing {
	return editing.get(sessionId) ?? NO_EDITING;
}

/** Keeps a draft's typed text in the store so it outlives its card. */
export function setDiffCommentDraftBody(sessionId: string, id: string, text: string): void {
	updateEditing(sessionId, (state) => ({...state, bodies: {...state.bodies, [id]: text}}));
}

/** Opens a comment card on the target lines, reusing one already open there, and makes it the active card. */
export function openDiffCommentDraft(sessionId: string, target: DiffCommentTarget): string {
	const existing = getDiffComments(sessionId).drafts.find((draft) => sameTarget(draft, target));
	if (existing !== undefined) {
		updateEditing(sessionId, (state) => ({...state, activeId: existing.id}));
		return existing.id;
	}
	const draft: DiffCommentDraft = {
		id: `${ID_PREFIX}${nextId++}`,
		path: target.path,
		side: target.side,
		line: target.line,
		...(target.endLine === undefined || target.endLine === target.line ? {} : {endLine: target.endLine}),
	};
	update(sessionId, (comments) => ({...comments, drafts: [...comments.drafts, draft]}));
	updateEditing(sessionId, (state) => ({...state, activeId: draft.id}));
	return draft.id;
}

export function discardDiffCommentDraft(sessionId: string, id: string): void {
	update(sessionId, (comments) => ({
		...comments,
		drafts: comments.drafts.filter((draft) => draft.id !== id),
	}));
	forgetDraft(sessionId, id);
}

/** Moves a draft into the queue with its comment text. */
export function saveDiffComment(sessionId: string, id: string, text: string): void {
	const draft = getDiffComments(sessionId).drafts.find((candidate) => candidate.id === id);
	if (draft === undefined || text.trim() === "") return;
	update(sessionId, (comments) => ({
		drafts: comments.drafts.filter((candidate) => candidate.id !== id),
		queued: [...comments.queued, {...draft, text: text.trim()}],
	}));
	forgetDraft(sessionId, id);
}

export function removeQueuedDiffComment(sessionId: string, id: string): void {
	update(sessionId, (comments) => ({
		...comments,
		queued: comments.queued.filter((comment) => comment.id !== id),
	}));
	forgetEdit(sessionId, id);
}

/** Opens a saved comment for editing (upstream `setActive`). */
export function activateDiffComment(sessionId: string, id: string): void {
	updateEditing(sessionId, (state) => ({...state, activeId: id}));
}

/** Keeps a saved comment's in-progress edit text in the store so it outlives its card. */
export function setDiffCommentEditBody(sessionId: string, id: string, text: string): void {
	updateEditing(sessionId, (state) => ({...state, editBodies: {...state.editBodies, [id]: text}}));
}

/** Saves an edit to a queued comment and closes it (upstream `updateAnnotation` + `setActive(null)`). */
export function updateQueuedDiffComment(sessionId: string, id: string, text: string): void {
	const trimmed = text.trim();
	if (trimmed === "") return;
	update(sessionId, (comments) => ({
		...comments,
		queued: comments.queued.map((comment) => (comment.id === id ? {...comment, text: trimmed} : comment)),
	}));
	forgetEdit(sessionId, id);
}

/** Abandons an edit, reverting to the saved text (upstream `clearEditBody` + `setActive(null)`). */
export function cancelDiffCommentEdit(sessionId: string, id: string): void {
	forgetEdit(sessionId, id);
}

/**
 * Returns the queued comments and empties the queue, as sending a prompt does. Like upstream `Me`, the
 * active card's unsaved edit text is sent in place of its saved text when it is non-empty and differs.
 */
export function takeQueuedDiffComments(sessionId: string): readonly QueuedDiffComment[] {
	const {queued} = getDiffComments(sessionId);
	if (queued.length === 0) return queued;
	const {activeId, editBodies} = getDiffCommentEditing(sessionId);
	const edit = activeId === null ? undefined : editBodies[activeId]?.trim();
	const sent =
		edit === undefined || edit === ""
			? queued
			: queued.map((comment) => (comment.id === activeId ? {...comment, text: edit} : comment));
	update(sessionId, (comments) => ({...comments, queued: []}));
	for (const comment of queued) forgetEdit(sessionId, comment.id);
	return sent;
}

export function clearDiffComments(sessionId: string): void {
	hydrate();
	if (sessions.has(sessionId)) update(sessionId, () => EMPTY);
	if (editing.has(sessionId)) updateEditing(sessionId, () => NO_EDITING);
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function useDiffComments(sessionId: string | undefined): DiffComments {
	return useSyncExternalStore(
		subscribe,
		() => (sessionId === undefined ? EMPTY : getDiffComments(sessionId)),
		() => EMPTY,
	);
}

export function useDiffCommentEditing(sessionId: string): DiffCommentEditing {
	return useSyncExternalStore(
		subscribe,
		() => getDiffCommentEditing(sessionId),
		() => NO_EDITING,
	);
}
