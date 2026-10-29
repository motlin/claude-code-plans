import type {DiffCommentDraft, QueuedDiffComment} from "../../lib/diff-comments";
import type {ReviewFinding} from "../../lib/review-diff";
import type {DiffFileAnnotation} from "./diff-file";
import {LineCommentCard, SavedCommentCard} from "./line-comment-card";
import {type FindingActions, ReviewFindingAnnotation} from "./review-finding-annotation";

/** Open comment cards and queued comments on `path` as inline diff annotations. */
export function commentAnnotations(
	sessionId: string,
	drafts: readonly DiffCommentDraft[],
	queued: readonly QueuedDiffComment[],
	path: string,
): DiffFileAnnotation[] {
	return [
		...queued
			.filter((comment) => comment.path === path)
			.map((comment) => ({
				side: comment.side,
				lineNumber: comment.endLine ?? comment.line,
				content: <SavedCommentCard key={comment.id} sessionId={sessionId} comment={comment} />,
			})),
		...drafts
			.filter((draft) => draft.path === path)
			.map((draft) => ({
				side: draft.side,
				lineNumber: draft.endLine ?? draft.line,
				content: <LineCommentCard key={draft.id} sessionId={sessionId} draft={draft} />,
			})),
	];
}

/** The unresolved findings for `path` as inline diff annotations. */
export function findingAnnotations(
	findings: readonly ReviewFinding[],
	path: string,
	actions: FindingActions,
): DiffFileAnnotation[] {
	return findings
		.filter((finding) => !finding.resolved && finding.file === path)
		.map((finding) => ({
			side: finding.side === "old" ? "deletions" : "additions",
			lineNumber: finding.endLine ?? finding.line,
			content: <ReviewFindingAnnotation key={finding.id} finding={finding} actions={actions} />,
		}));
}
