/**
 * The single definition of a "message" for session message counts.
 *
 * A message is a JSONL transcript record that:
 * - has type "user" or "assistant",
 * - is not a sidechain record (`isSidechain: true`), and
 * - carries message content beyond tool results (string content, or a
 *   content array with at least one non-tool_result block).
 *
 * Every surface that reports a message count -- the indexer (which fills the
 * `sessions.message_count` column consumed by the list, search, and detail
 * APIs), the filesystem session reader, the viewed-state counter behind
 * `newMessageCount`, and the client transcript view -- must count with this
 * predicate so the numbers always agree.
 *
 * Isomorphic: no Node-specific imports, usable in browser and server code.
 */
export function isCountableMessageRecord(record: unknown): boolean {
  if (typeof record !== "object" || record === null) return false;
  const candidate = record as {
    type?: unknown;
    isSidechain?: unknown;
    message?: unknown;
  };
  if (candidate.type !== "user" && candidate.type !== "assistant") return false;
  if (candidate.isSidechain === true) return false;

  const message = candidate.message;
  if (typeof message !== "object" || message === null) return false;
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return true;
  if (Array.isArray(content)) {
    return content.some(
      (block) =>
        typeof block === "object" &&
        block !== null &&
        (block as { type?: unknown }).type !== "tool_result",
    );
  }
  return false;
}

/**
 * A countable record's top-level `type` is "user" or "assistant", so every JSON
 * encoding of one contains the `type` key followed by that literal.
 */
const COUNTABLE_TYPE_PATTERN = /"type"\s*:\s*"(?:user|assistant)"/;

/**
 * Cheap prefilter for `isCountableMessageRecord` over an unparsed JSONL line.
 *
 * Counting the messages before a transcript window means testing every earlier
 * line, and JSON.parse dominates that: 86 ms of a 147 ms transcript read on a
 * measured 53 MB session. Two thirds of those bytes are records -- attachments,
 * system records, queue operations -- that cannot be messages, and matching the
 * `type` key is far cheaper than parsing them: 86 ms drops to 48 ms.
 *
 * Over-accepting is free (the caller parses the line it would have parsed
 * anyway), but rejecting a line `isCountableMessageRecord` would accept
 * silently undercounts, so this must widen in lockstep with that predicate.
 * Validated against every session JSONL on disk: 1,052,787 records, zero
 * countable records rejected.
 */
export function mightBeCountableMessageLine(line: string): boolean {
  return COUNTABLE_TYPE_PATTERN.test(line);
}

/** Count the messages in a sequence of parsed JSONL transcript records. */
export function countMessageRecords(records: Iterable<unknown>): number {
  let count = 0;
  for (const record of records) {
    if (isCountableMessageRecord(record)) count += 1;
  }
  return count;
}
