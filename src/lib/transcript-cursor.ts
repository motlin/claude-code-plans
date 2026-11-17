/**
 * Which transcript rows can anchor an earlier-page request: upstream's `z8`
 * predicate walked by `$i` (`shared-18`, `cef1e6037`). A cursor has to be a row
 * the file itself holds and keeps, so optimistic echoes, synthetic rows,
 * compact summaries and thinking-only assistant rows are passed over.
 */

const NON_CURSOR_FLAGS = [
	"isReplay",
	"isOptimisticEcho",
	"isSyntheticEcho",
	"isSyntheticReply",
	"isCompactSummary",
	"isVisibleInTranscriptOnly",
] as const;

const THINKING_BLOCK_TYPES = new Set(["thinking", "redacted_thinking"]);

function isThinkingOnly(record: Record<string, unknown>): boolean
{
	const message = record["message"];
	if (typeof message !== "object" || message === null || !("content" in message)) return false;
	const {content} = message;
	return (
		Array.isArray(content) &&
		content.length > 0 &&
		content.every(
			(block: unknown) =>
				typeof block === "object" &&
				block !== null &&
				"type" in block &&
				typeof block.type === "string" &&
				THINKING_BLOCK_TYPES.has(block.type),
		)
	);
}

function isCursorRow(record: Record<string, unknown>, uuid: string): boolean
{
	if (uuid === "" || uuid.startsWith("client-")) return false;
	if (record["type"] !== "user" && record["type"] !== "assistant") return false;
	if (NON_CURSOR_FLAGS.some((flag) => record[flag] === true)) return false;
	return !(record["type"] === "assistant" && isThinkingOnly(record));
}

/**
 * The uuid of the first cursor row at or after `from`. Upstream stops at the
 * first row without a uuid, because its host rows all carry one; a CLI JSONL
 * window routinely opens on uuid-less lines (snapshots, titles, modes), so here
 * they are passed over instead. The page served before the cursor re-serves
 * them, since it ends just before the cursor's line.
 */
export function cursorUuid(records: readonly Record<string, unknown>[], from = 0): string | undefined
{
	for (const record of records.slice(from))
	{
		const uuid = record["uuid"];
		if (typeof uuid === "string" && isCursorRow(record, uuid)) return uuid;
	}
	return undefined;
}
