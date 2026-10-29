import {useSyncExternalStore} from "react";

/**
 * Inline comments on the Plan pane's text, per session and in memory only
 * (upstream drops them on a full reload). Revise sends them, formatted by
 * `formatPlanFeedback`, as the plan rejection feedback.
 */

export interface PlanCommentInput {
	selectedText: string;
	/** Offsets into the pane's flattened plan text, `[startOffset, endOffset)`. */
	startOffset: number;
	endOffset: number;
	comment: string;
}

export interface PlanComment extends PlanCommentInput {
	id: string;
}

const EMPTY: readonly PlanComment[] = [];

let sessions = new Map<string, readonly PlanComment[]>();
const listeners = new Set<() => void>();

function update(sessionId: string, change: (comments: readonly PlanComment[]) => readonly PlanComment[]): void {
	const next = change(getPlanComments(sessionId));
	sessions = new Map(sessions);
	if (next.length === 0) sessions.delete(sessionId);
	else sessions.set(sessionId, next);
	for (const listener of listeners) listener();
}

export function getPlanComments(sessionId: string): readonly PlanComment[] {
	return sessions.get(sessionId) ?? EMPTY;
}

export function addPlanComment(sessionId: string, input: PlanCommentInput): string {
	const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
	update(sessionId, (comments) => [...comments, {...input, id}]);
	return id;
}

export function updatePlanComment(sessionId: string, id: string, comment: string): void {
	update(sessionId, (comments) => comments.map((c) => (c.id === id ? {...c, comment} : c)));
}

export function removePlanComment(sessionId: string, id: string): void {
	update(sessionId, (comments) => comments.filter((c) => c.id !== id));
}

/** Empties the session's comments and returns what was removed, for a restore if sending fails. */
export function clearPlanComments(sessionId: string): readonly PlanComment[] {
	const removed = getPlanComments(sessionId);
	if (sessions.has(sessionId)) update(sessionId, () => EMPTY);
	return removed;
}

/** Puts comments back ahead of any added since they were cleared. */
export function restorePlanComments(sessionId: string, restored: readonly PlanComment[]): void {
	if (restored.length > 0) update(sessionId, (comments) => [...restored, ...comments]);
}

/** Whether `[start, end)` intersects an existing comment's range. */
export function planCommentOverlaps(sessionId: string, start: number, end: number): boolean {
	return getPlanComments(sessionId).some((c) => start < c.endOffset && c.startOffset < end);
}

/**
 * Upstream's Revise feedback: each comment, in plan order, as an
 * "On selected text:" block with the selection quoted line by line, then the
 * typed text after a blank-line gap.
 */
export function formatPlanFeedback(comments: readonly PlanComment[], typed: string): string {
	const text = typed.trim();
	if (comments.length === 0) return text;
	const blocks = comments
		.toSorted((a, b) => a.startOffset - b.startOffset)
		.map((c) => {
			const quoted = c.selectedText
				.split(/\r\n?|[\n\u2028\u2029]/)
				.map((line) => `> ${line}`)
				.join("\n");
			return `On selected text:\n${quoted}\n${c.comment}`;
		});
	const joined = blocks.join("\n\n");
	return text === "" ? joined : `${joined}\n\n\n${text}`;
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function usePlanComments(sessionId: string | undefined): readonly PlanComment[] {
	return useSyncExternalStore(
		subscribe,
		() => (sessionId === undefined ? EMPTY : getPlanComments(sessionId)),
		() => EMPTY,
	);
}

export function usePlanCommentCount(sessionId: string | undefined): number {
	return usePlanComments(sessionId).length;
}
