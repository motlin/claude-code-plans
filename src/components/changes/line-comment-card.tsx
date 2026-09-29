import { X } from "lucide-react";
import { useState } from "react";

import {
  type DiffCommentDraft,
  type QueuedDiffComment,
  discardDiffCommentDraft,
  removeQueuedDiffComment,
  saveDiffComment,
} from "../../lib/diff-comments";
import type { DiffFileAnnotation } from "./diff-file";

const CARD_CLASS =
  "flex flex-col gap-1.5 rounded-r6 border border-border bg-surface-3 p-2 font-sans text-body text-primary";

const TEXTAREA_CLASS =
  "block min-h-[40px] w-full resize-none rounded-r5 bg-transparent px-1 py-0.5 font-sans text-body text-primary [field-sizing:content] placeholder:text-ink-muted focus:outline-none";

const SAVE_BUTTON_CLASS =
  "h-6 cursor-pointer rounded-r5 bg-accent-100 px-2 text-footnote text-white transition-opacity disabled:cursor-default disabled:opacity-40";

/** "Line 3", or "Lines 2–5" for a range. */
function lineLabel({ line, endLine }: { line: number; endLine?: number | undefined }) {
  return endLine === undefined || endLine === line ? `Line ${line}` : `Lines ${line}–${endLine}`;
}

function isSaveShortcut(event: React.KeyboardEvent): boolean {
  return event.key === "Enter" && (event.metaKey || event.ctrlKey);
}

/**
 * Upstream's inline comment card: "Line N", a "Request changes" textarea and
 * Save comment. Escape on an empty card removes it.
 */
function LineCommentCard({ sessionId, draft }: { sessionId: string; draft: DiffCommentDraft }) {
  const [text, setText] = useState("");
  const empty = text.trim() === "";
  const save = () => saveDiffComment(sessionId, draft.id, text);
  return (
    <div className="px-2 py-1">
      <div data-line-comment={draft.id} className={CARD_CLASS}>
        <span className="px-1 text-footnote text-ink-muted">{lineLabel(draft)}</span>
        <textarea
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- the card opens to be typed in
          autoFocus
          aria-label={`Request changes on ${lineLabel(draft).toLowerCase()}`}
          placeholder="Request changes"
          value={text}
          rows={1}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && empty) {
              event.preventDefault();
              event.stopPropagation();
              discardDiffCommentDraft(sessionId, draft.id);
            } else if (isSaveShortcut(event) && !empty) {
              event.preventDefault();
              save();
            }
          }}
          className={TEXTAREA_CLASS}
        />
        <div className="flex justify-end">
          <button type="button" disabled={empty} onClick={save} className={SAVE_BUTTON_CLASS}>
            Save comment
          </button>
        </div>
      </div>
    </div>
  );
}

/** A saved comment under its line, "Queued" until the next prompt sends it. */
function QueuedCommentCard({
  sessionId,
  comment,
}: {
  sessionId: string;
  comment: QueuedDiffComment;
}) {
  return (
    <div className="px-2 py-1">
      <div data-queued-comment={comment.id} className={CARD_CLASS}>
        <div className="flex items-center gap-1.5 px-1">
          <span className="text-footnote text-ink-muted">{lineLabel(comment)}</span>
          <span className="rounded-r5 bg-fill-control px-1 text-caption text-secondary">
            Queued
          </span>
          <button
            type="button"
            aria-label="Remove comment"
            onClick={() => removeQueuedDiffComment(sessionId, comment.id)}
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
        content: <QueuedCommentCard key={comment.id} sessionId={sessionId} comment={comment} />,
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
