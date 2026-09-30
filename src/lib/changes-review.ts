import {z} from "zod";

import {requestChangesScope} from "./changes-scope-request";
import {formatAttachContext} from "./context-attach";
import type {ReviewFinding} from "./review-diff";

/** The working-copy review whose findings a session's Changes pane shows on its Uncommitted scope. */
const CHANGES_REVIEW_STORAGE_KEY = "ccb.changesReview.v1";

/** Window event an already-open Changes pane listens for to show a review's findings. */
export const CHANGES_REVIEW_REQUEST_EVENT = "ccp:changes-review-request";

export interface ChangesReviewRequest {
	sessionId: string;
	reviewId: string;
}

const ChangesReviewStoreSchema = z.record(z.string(), z.string());

function browserStorage(): Storage | null {
	if (typeof window === "undefined") return null;
	try {
		return window.localStorage;
	} catch {
		return null;
	}
}

function readStore(storage: Storage): Record<string, string> {
	try {
		const raw = storage.getItem(CHANGES_REVIEW_STORAGE_KEY);
		if (raw === null) return {};
		const parsed = ChangesReviewStoreSchema.safeParse(JSON.parse(raw));
		return parsed.success ? parsed.data : {};
	} catch {
		return {};
	}
}

export function loadChangesReview(sessionId: string, storage: Storage | null = browserStorage()): string | null {
	return (storage && readStore(storage)[sessionId]) ?? null;
}

function saveChangesReview(sessionId: string, reviewId: string, storage: Storage | null = browserStorage()): void {
	if (!storage) return;
	try {
		storage.setItem(CHANGES_REVIEW_STORAGE_KEY, JSON.stringify({...readStore(storage), [sessionId]: reviewId}));
	} catch {
		// localStorage can be denied even when window exists; this is best-effort.
	}
}

export interface ReviewChangesTarget {
	to: "/session/$id";
	params: {id: string};
	search: {pane: "changes"};
}

/**
 * Point the session's Changes pane at `reviewId`'s findings on the Uncommitted
 * scope, and return where to navigate so the session opens with the pane.
 */
export function openReviewInChanges(sessionId: string, reviewId: string): ReviewChangesTarget {
	saveChangesReview(sessionId, reviewId);
	requestChangesScope(sessionId, "uncommitted");
	if (typeof window !== "undefined") {
		window.dispatchEvent(
			new CustomEvent<ChangesReviewRequest>(CHANGES_REVIEW_REQUEST_EVENT, {
				detail: {sessionId, reviewId},
			}),
		);
	}
	return {to: "/session/$id", params: {id: sessionId}, search: {pane: "changes"}};
}

/** `openReviewInChanges`'s target as an href. */
export function reviewChangesHref(sessionId: string): string {
	return `/session/${encodeURIComponent(sessionId)}?pane=changes`;
}

/** The chat-input text "Fix this one" sends for a finding. */
export function formatFixFindingPrompt(finding: ReviewFinding): string {
	const range = finding.side === "new" ? {start: finding.line, end: finding.endLine ?? finding.line} : undefined;
	const lines = [
		`Fix this review finding in ${formatAttachContext({path: finding.file, range})}: ${finding.title}`,
		"",
		finding.body,
	];
	if (finding.suggestion) lines.push("", "Suggested fix:", finding.suggestion);
	return lines.join("\n");
}
