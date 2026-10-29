import {X} from "lucide-react";
import {useRef} from "react";
import {flushSync} from "react-dom";

import {requestComposerAction} from "../../lib/context-attach";
import {
	type DiffCommentDraft,
	type QueuedDiffComment,
	discardDiffCommentDraft,
	getDiffCommentEditing,
	removeQueuedDiffComment,
	saveDiffComment,
	setDiffCommentDraftBody,
	useDiffCommentEditing,
} from "../../lib/diff-comments";
import {CommentEditor} from "../comment-editor";

const CARD_CLASS =
	"flex flex-col gap-1.5 rounded-r6 border border-border bg-surface-3 p-2 font-sans text-body text-primary";

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
				onSave={(text, {submit, viaKeyboard}) => {
					if (!viaKeyboard) {
						saveDiffComment(sessionId, draft.id, text);
						return;
					}
					// Commit the queued comment first, so the composer's send sees it.
					flushSync(() => {
						saveDiffComment(sessionId, draft.id, text);
					});
					requestComposerAction(sessionId, submit ? "submit" : "focus");
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

/** A saved comment under its line, "Queued" until the next prompt sends it. */
export function QueuedCommentCard({sessionId, comment}: {sessionId: string; comment: QueuedDiffComment}) {
	return (
		<div className="px-2 py-1">
			<div data-queued-comment={comment.id} className={CARD_CLASS}>
				<div className="flex items-center gap-1.5 px-1">
					<span className="text-footnote text-ink-muted">{lineLabel(comment)}</span>
					<span className="rounded-r5 bg-fill-control px-1 text-caption text-secondary">Queued</span>
					<button
						type="button"
						aria-label="Remove comment"
						onClick={() => {
							removeQueuedDiffComment(sessionId, comment.id);
						}}
						className="ml-auto flex size-5 cursor-pointer items-center justify-center rounded-r5 text-secondary hover:bg-fill-ghost-hover hover:text-primary"
					>
						<X aria-hidden="true" className="size-3" />
					</button>
				</div>
				<p className="whitespace-pre-wrap break-words px-1">{comment.text}</p>
			</div>
		</div>
	);
}
