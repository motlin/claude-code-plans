import type { MessageAnchor } from "./message-anchor";
import { messageAnchorId } from "./message-anchor";

const MAX_PRECEDING_INDICES = 50;
const HIGHLIGHT_DURATION_MS = 2_000;

function flash(element: Element): true {
  element.scrollIntoView({ block: "center", behavior: "smooth" });
  element.classList.add("message-highlight");
  setTimeout(() => element.classList.remove("message-highlight"), HIGHLIGHT_DURATION_MS);
  return true;
}

/**
 * Scroll to the turn `anchor` addresses and flash it.
 *
 * The uuid finds the row directly. Not every record renders its own row
 * though: a run of tool calls collapses into one row carrying the run's first
 * record, bash output folds into the command above it, and tool_result records
 * render nothing at all. So when the uuid names no row, walk backwards a
 * bounded distance over the record indices the rows carry to find the row that
 * swallowed it. Returns false when nothing matched -- which is also what a deep
 * link into a record the client has not paged in yet does, and is why the
 * caller must not treat false as "close enough".
 */
export function jumpToMessage(anchor: MessageAnchor): boolean {
  if (anchor.uuid !== undefined) {
    const element = document.getElementById(messageAnchorId(anchor.uuid));
    if (element) return flash(element);
  }

  if (anchor.recordIndex === undefined) return false;

  for (let offset = 0; offset <= MAX_PRECEDING_INDICES; offset += 1) {
    const candidateIndex = anchor.recordIndex - offset;
    if (candidateIndex < 0) break;

    const element = document.querySelector(`[data-record-index="${candidateIndex}"]`);
    if (element) return flash(element);
  }

  return false;
}
