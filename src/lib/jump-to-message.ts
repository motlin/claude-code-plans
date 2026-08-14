import { messageAnchorId } from "./message-anchor";

const MAX_PRECEDING_INDICES = 50;
const HIGHLIGHT_DURATION_MS = 2_000;

/**
 * How a rendered row is found -- which is not the same as how it is addressed.
 *
 * The anchor value finds the row directly, when the record renders one. The
 * `recordIndex` is the fallback: a run of tool calls collapses into a single
 * row carrying the run's first record, so the record being jumped to may render
 * no row of its own and has to be found from the row that swallowed it.
 */
export interface JumpTarget {
  /** The value the row is anchored on: the record's uuid, where it has one. */
  uuid?: string;
  /** Session-absolute JSONL index of the record, for the swallowed-row walk. */
  recordIndex?: number;
}

export const TRANSCRIPT_JUMP_REQUEST_EVENT = "transcript-jump-request";

export interface TranscriptJumpRequestEvent extends CustomEvent<JumpTarget> {
  type: typeof TRANSCRIPT_JUMP_REQUEST_EVENT;
}

function flash(element: Element): true {
  element.scrollIntoView({ block: "center", behavior: "smooth" });
  element.classList.add("message-highlight");
  setTimeout(() => element.classList.remove("message-highlight"), HIGHLIGHT_DURATION_MS);
  return true;
}

/**
 * Scroll to the turn `target` names and flash it.
 *
 * The anchor value finds the row directly. Not every record renders its own row
 * though: a run of tool calls collapses into one row carrying the run's first
 * record, bash output folds into the command above it, and tool_result records
 * render nothing at all. So when the anchor names no row, walk backwards a
 * bounded distance over the record indices the rows carry to find the row that
 * swallowed it. Returns false when nothing matched -- which is also what a deep
 * link into a record the client has not paged in yet does, and is why the
 * caller must not treat false as "close enough".
 */
export function jumpToMessage(target: JumpTarget): boolean {
  if (target.uuid !== undefined) {
    const element = document.getElementById(messageAnchorId(target.uuid));
    if (element) return flash(element);
  }

  if (target.recordIndex === undefined) return false;

  for (let offset = 0; offset <= MAX_PRECEDING_INDICES; offset += 1) {
    const candidateIndex = target.recordIndex - offset;
    if (candidateIndex < 0) break;

    const element = document.querySelector(`[data-record-index="${candidateIndex}"]`);
    if (element) return flash(element);
  }

  window.dispatchEvent(
    new CustomEvent<JumpTarget>(TRANSCRIPT_JUMP_REQUEST_EVENT, { detail: target }),
  );

  return false;
}
