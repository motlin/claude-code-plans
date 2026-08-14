const MAX_PRECEDING_INDICES = 50;
const HIGHLIGHT_DURATION_MS = 2_000;

export const TRANSCRIPT_JUMP_REQUEST_EVENT = "transcript-jump-request";

export interface TranscriptJumpRequestEvent extends CustomEvent<number> {
  type: typeof TRANSCRIPT_JUMP_REQUEST_EVENT;
}

function flash(element: Element): true {
  element.scrollIntoView({ block: "center", behavior: "smooth" });
  element.classList.add("message-highlight");
  setTimeout(() => element.classList.remove("message-highlight"), HIGHLIGHT_DURATION_MS);
  return true;
}

/**
 * Scroll to the turn holding the record at `recordIndex` and flash it.
 *
 * Rows are found by the session-absolute record index they carry, which is the
 * only thing that names one: turns carry no id and no URL of their own, the way
 * upstream claude.ai/code renders them. Not every record renders its own row
 * either -- a run of tool calls collapses into one row carrying the run's first
 * record, bash output folds into the command above it, and tool_result records
 * render nothing at all -- so walk backwards a bounded distance to find the row
 * that swallowed it. Returns false when nothing matched, which is also what a
 * jump into a record the client has not paged in yet does, and is why the
 * caller must not treat false as "close enough".
 */
export function jumpToMessage(recordIndex: number): boolean {
  for (let offset = 0; offset <= MAX_PRECEDING_INDICES; offset += 1) {
    const candidateIndex = recordIndex - offset;
    if (candidateIndex < 0) break;

    const element = document.querySelector(`[data-record-index="${candidateIndex}"]`);
    if (element) return flash(element);
  }

  window.dispatchEvent(
    new CustomEvent<number>(TRANSCRIPT_JUMP_REQUEST_EVENT, { detail: recordIndex }),
  );

  return false;
}
