/**
 * How a transcript turn is addressed.
 *
 * The `uuid` is the message's own identity, carried on its JSONL record, and is
 * what a copied `#msg-<uuid>` link names: it survives the session growing, the
 * tail window sliding, and the record being renumbered, none of which a
 * positional anchor does.
 *
 * The `recordIndex` is not an address -- it is how the row is *found* when the
 * uuid names a record that renders no row of its own, because a run of tool
 * calls collapsed it into a neighbouring row. It also carries the anchors of
 * links copied before anchors moved to uuids.
 */
export interface MessageAnchor {
  uuid?: string;
  recordIndex?: number;
}

/** The `id` a turn's row is addressed by, from the value it is anchored on. */
export function messageAnchorId(anchorValue: string): string {
  return `msg-${anchorValue}`;
}

/**
 * The value a record is anchored on: its own uuid, or -- for the rare record
 * that carries none -- its session-absolute JSONL record index, so that every
 * rendered row still has an anchor.
 */
export function messageAnchorValue(record: {
  uuid?: string | undefined;
  lineIndex: number;
}): string {
  return record.uuid ?? String(record.lineIndex);
}

/**
 * The anchor named by a location hash, or undefined when the hash is not a
 * message anchor. Accepts the hash with or without its leading `#`.
 *
 * An all-digit anchor is read as a record index: links of the form `#msg-<n>`
 * were handed out by earlier builds, and honouring them costs one branch here
 * plus the `data-record-index` every row already carries for the swallowed-row
 * walk. The character class is deliberately narrow -- the value reaches an
 * attribute selector in `jumpToMessage`.
 */
export function parseMessageAnchor(hash: string): MessageAnchor | undefined {
  const match = /^#?msg-([A-Za-z0-9_-]+)$/.exec(hash);
  if (!match) return undefined;

  const value = match[1]!;
  if (/^\d+$/.test(value)) return { recordIndex: Number(value) };
  return { uuid: value };
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
  anchor: MessageAnchor | undefined,
  held: HeldRecords,
): MessageAnchorAction {
  if (anchor === undefined) return "none";

  if (anchor.uuid !== undefined) {
    if (held.uuids.has(anchor.uuid)) return "jump";
  } else if (anchor.recordIndex !== undefined) {
    if (anchor.recordIndex >= held.startIndex) return "jump";
  } else {
    return "none";
  }

  return held.startIndex === 0 ? "none" : "load-earlier";
}
