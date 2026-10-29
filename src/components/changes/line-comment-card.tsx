import {useRef} from "react";
import {flushSync} from "react-dom";

import {requestComposerAction} from "../../lib/context-attach";
import {
	type DiffCommentDraft,
	type QueuedDiffComment,
	activateDiffComment,
	cancelDiffCommentEdit,
	discardDiffCommentDraft,
	getDiffCommentEditing,
	removeQueuedDiffComment,
	saveDiffComment,
	setDiffCommentDraftBody,
	setDiffCommentEditBody,
	updateQueuedDiffComment,
	useDiffCommentEditing,
} from "../../lib/diff-comments";
import {CommentEditor} from "../comment-editor";

/**
 * Runs a comment save; after a keyboard save it then focuses the composer (Enter) or sends it (⌘Enter), as
 * upstream `onAnnotationSaved` does.
 */
function saveThenRequestComposer(
	sessionId: string,
	{submit, viaKeyboard}: {submit: boolean; viaKeyboard: boolean},
	save: () => void,
): void {
	if (!viaKeyboard) {
		save();
		return;
	}
	// Commit the queued comment first, so the composer's send sees it.
	flushSync(save);
	requestComposerAction(sessionId, submit ? "submit" : "focus");
}

/** "Line 3", or "Lines 2–5" for a range. */
function lineLabel({line, endLine}: {line: number; endLine?: number | undefined}) {
	return endLine === undefined || endLine === line ? `Line ${line}` : `Lines ${line}–${endLine}`;
}

/** Upstream's input label: "Comment on line 3", or "Comment on lines 2–5". */
function inputLabel({line, endLine}: {line: number; endLine?: number | undefined}) {
	return endLine === undefined || endLine === line
		? `Comment on line ${line}`
		: `Comment on lines ${line}–${endLine}`;
}

/**
 * Upstream's diff draft card (`Ie` + `Uc`): the shared inline `CommentEditor` with "Tell Claude what to
 * change". Enter saves and focuses the composer, ⌘Enter saves and sends, Escape discards the draft, and an
 * empty draft is discarded once focus leaves the card. The typed text lives in the store, so it outlives
 * the card.
 */
export function LineCommentCard({sessionId, draft}: {sessionId: string; draft: DiffCommentDraft}) {
	const {bodies, activeId} = useDiffCommentEditing(sessionId);
	const cardRef = useRef<HTMLDivElement>(null);
	return (
		<div data-line-comment={draft.id}>
			<CommentEditor
				isEditing
				autoFocus
				isActive={activeId === draft.id}
				label={lineLabel(draft)}
				inputLabel={inputLabel(draft)}
				placeholder="Tell Claude what to change"
				value={bodies[draft.id] ?? ""}
				onChange={(text) => {
					setDiffCommentDraftBody(sessionId, draft.id, text);
				}}
				onSave={(text, options) => {
					saveThenRequestComposer(sessionId, options, () => {
						saveDiffComment(sessionId, draft.id, text);
					});
				}}
				onCancel={() => {
					discardDiffCommentDraft(sessionId, draft.id);
				}}
				onInputBlur={(event) => {
					if (event.relatedTarget instanceof Node && cardRef.current?.contains(event.relatedTarget)) return;
					requestAnimationFrame(() => {
						if ((getDiffCommentEditing(sessionId).bodies[draft.id] ?? "").trim() === "")
							discardDiffCommentDraft(sessionId, draft.id);
					});
				}}
				cardRef={cardRef}
			/>
		</div>
	);
}

/**
 * A saved comment under its line (upstream `Ie` with an annotation): the same card with a clickable body and
 * revealed Edit and Delete. Clicking the body or Edit opens it for editing; Enter saves (and focuses the
 * composer, ⌘Enter sends), Escape reverts to the saved text. The composer sends it with the next prompt.
 */
export function SavedCommentCard({sessionId, comment}: {sessionId: string; comment: QueuedDiffComment}) {
	const {editBodies, activeId} = useDiffCommentEditing(sessionId);
	const isEditing = activeId === comment.id;
	return (
		<div data-saved-comment={comment.id}>
			<CommentEditor
				isEditing={isEditing}
				isActive={isEditing}
				autoFocus={isEditing}
				label={lineLabel(comment)}
				inputLabel={inputLabel(comment)}
				placeholder="Tell Claude what to change"
				value={isEditing ? (editBodies[comment.id] ?? comment.text) : comment.text}
				onChange={(text) => {
					setDiffCommentEditBody(sessionId, comment.id, text);
				}}
				onActivate={() => {
					activateDiffComment(sessionId, comment.id);
				}}
				onDelete={
					isEditing
						? undefined
						: () => {
								removeQueuedDiffComment(sessionId, comment.id);
							}
				}
				onSave={(text, options) => {
					saveThenRequestComposer(sessionId, options, () => {
						updateQueuedDiffComment(sessionId, comment.id, text);
					});
				}}
				onCancel={() => {
					cancelDiffCommentEdit(sessionId, comment.id);
				}}
			/>
		</div>
	);
}
