import { useSyncExternalStore } from "react";

import type { ReviewComment } from "./context-attach";

/**
 * "Request changes" comments on Changes pane diff lines, per session and in
 * memory only. An open comment card is a draft; Save comment queues it, and
 * the session's composer sends the queued comments with its next prompt.
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

const EMPTY: DiffComments = { drafts: [], queued: [] };

let sessions = new Map<string, DiffComments>();
const listeners = new Set<() => void>();
let nextId = 1;

function update(sessionId: string, change: (comments: DiffComments) => DiffComments): void {
  const next = change(getDiffComments(sessionId));
  sessions = new Map(sessions);
  if (next.drafts.length === 0 && next.queued.length === 0) sessions.delete(sessionId);
  else sessions.set(sessionId, next);
  for (const listener of listeners) listener();
}

function sameTarget(a: DiffCommentTarget, b: DiffCommentTarget): boolean {
  return (
    a.path === b.path &&
    a.side === b.side &&
    a.line === b.line &&
    (a.endLine ?? a.line) === (b.endLine ?? b.line)
  );
}

export function getDiffComments(sessionId: string): DiffComments {
  return sessions.get(sessionId) ?? EMPTY;
}

/** Opens a comment card on the target lines, reusing one already open there. */
export function openDiffCommentDraft(sessionId: string, target: DiffCommentTarget): string {
  const existing = getDiffComments(sessionId).drafts.find((draft) => sameTarget(draft, target));
  if (existing !== undefined) return existing.id;
  const draft: DiffCommentDraft = {
    id: `diff-comment-${nextId++}`,
    path: target.path,
    side: target.side,
    line: target.line,
    ...(target.endLine === undefined || target.endLine === target.line
      ? {}
      : { endLine: target.endLine }),
  };
  update(sessionId, (comments) => ({ ...comments, drafts: [...comments.drafts, draft] }));
  return draft.id;
}

export function discardDiffCommentDraft(sessionId: string, id: string): void {
  update(sessionId, (comments) => ({
    ...comments,
    drafts: comments.drafts.filter((draft) => draft.id !== id),
  }));
}

/** Moves a draft into the queue with its comment text. */
export function saveDiffComment(sessionId: string, id: string, text: string): void {
  const draft = getDiffComments(sessionId).drafts.find((candidate) => candidate.id === id);
  if (draft === undefined || text.trim() === "") return;
  update(sessionId, (comments) => ({
    drafts: comments.drafts.filter((candidate) => candidate.id !== id),
    queued: [...comments.queued, { ...draft, text: text.trim() }],
  }));
}

export function removeQueuedDiffComment(sessionId: string, id: string): void {
  update(sessionId, (comments) => ({
    ...comments,
    queued: comments.queued.filter((comment) => comment.id !== id),
  }));
}

/** Returns the queued comments and empties the queue, as sending a prompt does. */
export function takeQueuedDiffComments(sessionId: string): readonly QueuedDiffComment[] {
  const { queued } = getDiffComments(sessionId);
  if (queued.length > 0) update(sessionId, (comments) => ({ ...comments, queued: [] }));
  return queued;
}

export function clearDiffComments(sessionId: string): void {
  if (sessions.has(sessionId)) update(sessionId, () => EMPTY);
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
