import { messageAnchorId } from "./message-anchor";

const MAX_PRECEDING_INDICES = 50;
const HIGHLIGHT_DURATION_MS = 2_000;

/**
 * Scroll to the turn anchored at `anchorIndex` (a session-absolute JSONL record
 * index) and flash it.
 *
 * Not every record renders its own anchor: a run of tool calls collapses into
 * one row carrying the run's first index, and the tool_result records in
 * between render nothing at all. So walk backwards a bounded distance to find
 * the row that actually swallowed the target. Returns false when nothing
 * matched -- which is also what a deep link into a record the client has not
 * paged in yet does, and is why the caller must not treat false as "close
 * enough".
 */
export function jumpToMessage(anchorIndex: number): boolean {
  for (let offset = 0; offset <= MAX_PRECEDING_INDICES; offset += 1) {
    const candidateIndex = anchorIndex - offset;
    if (candidateIndex < 0) break;

    const element = document.getElementById(messageAnchorId(candidateIndex));
    if (!element) continue;

    element.scrollIntoView({ block: "center", behavior: "smooth" });
    element.classList.add("message-highlight");
    setTimeout(() => element.classList.remove("message-highlight"), HIGHLIGHT_DURATION_MS);
    return true;
  }

  return false;
}
