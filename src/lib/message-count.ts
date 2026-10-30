import {isRecord} from "./narrow";
import {chainSkeleton, computeAbandoned} from "./transcript-chain";

/**
 * The single definition of a "message" for session message counts.
 *
 * A message is a JSONL transcript record that:
 * - has type "user" or "assistant",
 * - is not a sidechain record (`isSidechain: true`), and
 * - carries message content beyond tool results (string content, or a
 *   content array with at least one non-tool_result block).
 *
 * Session totals and window numbering also leave out records on an abandoned
 * branch (transcript-chain.ts), the way upstream's desktop host counts only
 * chain rows: see `ActiveChainMessageCounter`.
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
	if (!isRecord(record)) return false;
	if (record["type"] !== "user" && record["type"] !== "assistant") return false;
	if (record["isSidechain"] === true) return false;

	const message = record["message"];
	if (!isRecord(message)) return false;
	const content = message["content"];
	if (typeof content === "string") return true;
	if (Array.isArray(content)) {
		return content.some((block: unknown) => isRecord(block) && block["type"] !== "tool_result");
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

function uuidOf(record: unknown): string | undefined {
	const uuid = isRecord(record) ? record["uuid"] : undefined;
	return typeof uuid === "string" ? uuid : undefined;
}

/**
 * Count the messages in a sequence of parsed JSONL transcript records, leaving
 * out any whose uuid is in `hidden` (a transcript window's abandoned rows).
 */
export function countMessageRecords(records: Iterable<unknown>, hidden?: ReadonlySet<string>): number {
	let count = 0;
	for (const record of records) {
		if (!isCountableMessageRecord(record)) continue;
		const uuid = hidden === undefined ? undefined : uuidOf(record);
		if (uuid !== undefined && hidden?.has(uuid) === true) continue;
		count += 1;
	}
	return count;
}

/**
 * Folds a transcript one record at a time and counts its messages on the active
 * chain. The chain can only be known once the whole file is read (an appended
 * prompt can abandon an earlier branch), so it keeps each record's small
 * `chainSkeleton` and the countable records' uuids, and resolves on `count()`.
 */
export class ActiveChainMessageCounter {
	private readonly skeletons: Record<string, unknown>[] = [];
	/** The uuid of each countable record so far; undefined when it has none. */
	private readonly countable: (string | undefined)[] = [];

	add(record: unknown): void {
		if (!isRecord(record)) return;
		this.skeletons.push(chainSkeleton(record));
		if (isCountableMessageRecord(record)) this.countable.push(uuidOf(record));
	}

	count(): number {
		const {hidden} = computeAbandoned(this.skeletons);
		if (hidden.size === 0) return this.countable.length;
		return this.countable.filter((uuid) => uuid === undefined || !hidden.has(uuid)).length;
	}
}

/** Count the messages of a whole transcript that sit on its active chain. */
export function countActiveChainMessages(records: Iterable<unknown>): number {
	const counter = new ActiveChainMessageCounter();
	for (const record of records) counter.add(record);
	return counter.count();
}
