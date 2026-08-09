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

/** Count the messages in a sequence of parsed JSONL transcript records. */
export function countMessageRecords(records: Iterable<unknown>): number {
  let count = 0;
  for (const record of records) {
    if (isCountableMessageRecord(record)) count += 1;
  }
  return count;
}
