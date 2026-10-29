import {getSingularPatch} from "@pierre/diffs";

import type {DiffCommentDraft, DiffSide, QueuedDiffComment} from "../../lib/diff-comments";
import type {ReviewFinding} from "../../lib/review-diff";
import type {DiffFileAnnotation} from "./diff-file";
import {LineCommentCard, SavedCommentCard} from "./line-comment-card";
import {type FindingActions, ReviewFindingAnnotation} from "./review-finding-annotation";

/** The line ranges, as inclusive `[start, end]` pairs, a file diff shows on each side. */
export type DiffLineRanges = Record<DiffSide, readonly (readonly [number, number])[]>;

/** The line ranges each side of a single-file patch shows, one per hunk. */
export function diffLineRanges(patch: string): DiffLineRanges {
	const {hunks} = getSingularPatch(patch);
	const ranges = (start: (typeof hunks)[number]["additionStart"], count: number) =>
		count === 0 ? [] : [[start, start + count - 1] as const];
	return {
		additions: hunks.flatMap((hunk) => ranges(hunk.additionStart, hunk.additionCount)),
		deletions: hunks.flatMap((hunk) => ranges(hunk.deletionStart, hunk.deletionCount)),
	};
}

/**
 * Where a saved comment sits in the current diff: its own line when the diff still shows it, otherwise the
 * nearest shown line on its side (or the file end), flagged outdated as upstream's "Outdated" badge.
 */
function commentAnchor(
	{side, line}: {side: DiffSide; line: number},
	lines: DiffLineRanges | undefined,
): {side: DiffSide; lineNumber: number; outdated: boolean} {
	if (lines === undefined || lines[side].some(([start, end]) => line >= start && line <= end))
		return {side, lineNumber: line, outdated: false};
	const nearest = lines[side]
		.map(([start, end]) => Math.min(Math.max(line, start), end))
		.reduce<number | undefined>(
			(best, candidate) =>
				best === undefined || Math.abs(candidate - line) < Math.abs(best - line) ? candidate : best,
			undefined,
		);
	if (nearest !== undefined) return {side, lineNumber: nearest, outdated: true};
	const otherSide: DiffSide = side === "additions" ? "deletions" : "additions";
	const fileEnd = lines[otherSide].at(-1)?.[1];
	return fileEnd === undefined
		? {side, lineNumber: line, outdated: true}
		: {side: otherSide, lineNumber: fileEnd, outdated: true};
}

/**
 * Open comment cards and queued comments on `path` as inline diff annotations. With the diff's `lines`, a
 * queued comment whose line is no longer shown is anchored to the nearest shown line and marked outdated.
 */
export function commentAnnotations(
	sessionId: string,
	drafts: readonly DiffCommentDraft[],
	queued: readonly QueuedDiffComment[],
	path: string,
	lines?: DiffLineRanges,
): DiffFileAnnotation[] {
	return [
		...queued
			.filter((comment) => comment.path === path)
			.map((comment) => {
				const {outdated, ...anchor} = commentAnchor(
					{side: comment.side, line: comment.endLine ?? comment.line},
					lines,
				);
				return {
					...anchor,
					content: (
						<SavedCommentCard
							key={comment.id}
							sessionId={sessionId}
							comment={comment}
							outdated={outdated}
						/>
					),
				};
			}),
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
