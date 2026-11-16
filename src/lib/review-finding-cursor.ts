import {useSyncExternalStore} from "react";

import type {ReviewFinding} from "./review-diff";

/*
 * claude.ai/code's current review finding: the `diff-annotations` store's `currentFindingBySession` (cc8941b7b), which
 * upstream keeps out of `partialize`, so it lives in memory here too. `hidden` stands in for upstream's
 * `clearReviewFindings(session, true)`: local findings live in a saved review, so the findings bar's Close hides that
 * review's findings for the session until it is opened again.
 */

const current = new Map<string, string>();
const hidden = new Map<string, string>();
const listeners = new Set<() => void>();

function notify(): void
{
	for (const listener of listeners) listener();
}

export function subscribeReviewFindingCursor(listener: () => void): () => void
{
	listeners.add(listener);
	return () =>
	{
		listeners.delete(listener);
	};
}

/** Upstream `setCurrentReviewFinding`: a no-op when the id is unchanged. */
export function setCurrentReviewFinding(sessionId: string, id: string | null): void
{
	if ((current.get(sessionId) ?? null) === id) return;
	if (id === null) current.delete(sessionId);
	else current.set(sessionId, id);
	notify();
}

export function currentReviewFinding(sessionId: string): string | null
{
	return current.get(sessionId) ?? null;
}

export function clearReviewFindingCursor(sessionId: string): void
{
	setCurrentReviewFinding(sessionId, null);
}

/** Upstream selector `Zy(session)`. */
export function useCurrentReviewFinding(sessionId: string | undefined): string | null
{
	return useSyncExternalStore(
		subscribeReviewFindingCursor,
		() => (sessionId === undefined ? null : currentReviewFinding(sessionId)),
		() => null,
	);
}

/** The findings bar's Close: hide `reviewId`'s findings and drop the current one. */
export function hideReviewFindings(sessionId: string, reviewId: string): void
{
	current.delete(sessionId);
	hidden.set(sessionId, reviewId);
	notify();
}

/** Opening a review again shows its findings (upstream's next `setReviewFindings`). */
export function showReviewFindings(sessionId: string): void
{
	if (!hidden.delete(sessionId)) return;
	notify();
}

export function reviewFindingsHidden(sessionId: string, reviewId: string | null): boolean
{
	return reviewId !== null && hidden.get(sessionId) === reviewId;
}

export function useReviewFindingsHidden(sessionId: string, reviewId: string | null): boolean
{
	return useSyncExternalStore(
		subscribeReviewFindingCursor,
		() => reviewFindingsHidden(sessionId, reviewId),
		() => false,
	);
}

/** Upstream `zw`'s `A`: the current finding's index, a missing current counting as the first. */
export function findingCursorIndex(findings: readonly ReviewFinding[], currentId: string | null): number
{
	return Math.max(
		0,
		findings.findIndex((finding) => finding.id === currentId),
	);
}

/** Upstream `stepReviewFinding`: the next finding, wrapping to the first; null when that is the same finding. */
export function stepWrap(findings: readonly ReviewFinding[], id: string): ReviewFinding | null
{
	const index = findings.findIndex((finding) => finding.id === id);
	const next = findings[index + 1] ?? findings[0];
	return next === undefined || next.id === id ? null : next;
}
