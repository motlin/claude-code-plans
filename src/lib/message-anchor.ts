/**
 * The `#msg-<n>` anchor a transcript turn is addressed by.
 *
 * `n` is the JSONL record index of the message within the whole session file,
 * not its position in the rendered array. The transcript endpoint serves only
 * the tail window of a long session, and that window's boundary moves every
 * time the session grows, so a window-relative anchor would silently retarget a
 * link the day after it was copied.
 */
export function messageAnchorId(recordIndex: number): string {
  return `msg-${recordIndex}`;
}

/**
 * The record index named by a location hash, or undefined when the hash is not
 * a message anchor. Accepts the hash with or without its leading `#`.
 */
export function parseMessageAnchor(hash: string): number | undefined {
  const match = /^#?msg-(\d+)$/.exec(hash);
  if (!match) return undefined;
  return Number(match[1]);
}

/** What a `#msg-<n>` deep link still needs before it can scroll. */
export type MessageAnchorAction = "jump" | "load-earlier" | "none";

/**
 * Resolve a deep link against the transcript window the client currently holds.
 *
 * A link shared from a long-running session routinely names a record that has
 * since slid off the front of the tail window, so the anchor has to pull its
 * own history in rather than quietly scrolling to whatever happens to be
 * nearby. `"none"` at `windowStartIndex === 0` is the terminating case: the
 * whole file is loaded and the anchor simply does not exist.
 */
export function messageAnchorAction(
  anchorIndex: number | undefined,
  windowStartIndex: number,
): MessageAnchorAction {
  if (anchorIndex === undefined) return "none";
  if (anchorIndex >= windowStartIndex) return "jump";
  if (windowStartIndex === 0) return "none";
  return "load-earlier";
}
