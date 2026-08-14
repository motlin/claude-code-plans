/** The `id` a turn's row is addressed by, from the value it is anchored on. */
export function messageAnchorId(anchorValue: string): string {
  return `msg-${anchorValue}`;
}

/**
 * The value a record is anchored on.
 *
 * A message's uuid is its own identity, carried on its JSONL record, and is
 * what a copied `#msg-<uuid>` link names: it survives the session growing, the
 * tail window sliding, and the record being renumbered, none of which a
 * positional anchor does.
 *
 * The record types that carry no uuid at all -- the session-init banners,
 * pr links, worktree switches -- still render a row, so they fall back to
 * their session-absolute JSONL record index. It goes out as `line-<n>` rather
 * than a bare number so that no row on the page answers to a bare record
 * index, and a hash naming one scrolls to nothing.
 */
export function messageAnchorValue(record: {
  uuid?: string | undefined;
  lineIndex: number;
}): string {
  return record.uuid ?? `line-${record.lineIndex}`;
}

/**
 * The anchor value named by a location hash, or undefined when the hash is not
 * a message anchor. Accepts the hash with or without its leading `#`.
 *
 * An all-digit value is rejected: nothing anchors on a bare record index, so
 * such a hash names no row, and honouring it as an index would scroll to
 * whatever record happens to sit at that position today.
 */
export function parseMessageAnchor(hash: string): string | undefined {
  const match = /^#?msg-([A-Za-z0-9_-]+)$/.exec(hash);
  if (!match) return undefined;

  const value = match[1]!;
  return /^\d+$/.test(value) ? undefined : value;
}

/** What a `#msg-<uuid>` deep link still needs before it can scroll. */
export type MessageAnchorAction = "jump" | "load-earlier" | "none";

/** The transcript window the client currently holds. */
export interface HeldRecords {
  /** Session-absolute JSONL index of the first record the client holds. */
  startIndex: number;
  /** uuids of the records held -- a Set, or the transcript's uuid-to-line map. */
  uuids: { has(uuid: string): boolean };
}

/**
 * Resolve a deep link against the transcript window the client currently holds.
 *
 * A link shared from a long-running session routinely names a message that has
 * since slid off the front of the tail window, so the anchor has to pull its
 * own history in rather than quietly scrolling to whatever happens to be
 * nearby. A uuid carries no ordering, so the question is not "is it before the
 * window?" but "is it among the records I hold?" -- and `"none"` at
 * `startIndex === 0` is the terminating case: the whole file is loaded, so the
 * anchor simply does not belong to this session.
 */
export function messageAnchorAction(
  anchorValue: string | undefined,
  held: HeldRecords,
): MessageAnchorAction {
  if (anchorValue === undefined) return "none";
  if (held.uuids.has(anchorValue)) return "jump";

  return held.startIndex === 0 ? "none" : "load-earlier";
}
