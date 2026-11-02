/**
 * Upstream claude.ai/code's test for an interrupted tool call (c06cf64bb `vl`): an errored result
 * counts as interrupted -- not refused -- when its denial kind says so, when the CLI recorded
 * "User rejected tool use" as the result, or when its text is one of the interrupt notices.
 */

/** The CLI's `toolUseResult` for a call the user stopped (shared-m-0 `V3`). */
const USER_REJECTED_TOOL_USE = "User rejected tool use";

/** shared-m-0 `yZ`: the memory note the CLI may append to a refusal notice. */
const MEMORY_NOTE =
	"\n\nNote: The user's next message may contain a correction or preference. Pay close attention — if they explain what went wrong or how they'd prefer you to work, consider saving that to memory for future sessions.";

/** shared-m-0 `SQ`. */
const TURN_ENDED_NOTICE =
	"[Tool call did not complete: the turn was ended to deliver the message that follows. Nothing refused it; re-run it if still needed.]";

/** shared-m-0 `qE`: notices for a call that never finished, which nobody refused. */
const UNFINISHED_NOTICES: ReadonlySet<string> = new Set([
	TURN_ENDED_NOTICE,
	"[Tool call interrupted: the session ended before this call's result was recorded, so its outcome is unknown. Check whether it took effect before relying on it or running it again.]",
	"[Tool call result not in this copy: this session was copied from another session before that session recorded this call's result. The call may have finished there, may still be running there, or may never have run. Check whether it took effect before relying on it or running it again.]",
	"[Tool call not completed: an approval request expired with no answer, so the action awaiting approval did not run. Nobody refused it, so this is not the user's decision; ask again if it is still needed.]",
	"[Tool call not completed: an approval request was still unanswered when the message that follows arrived and was closed, so the action awaiting approval did not run. Nobody refused it, so this is not the user's decision; ask again if it is still needed.]",
]);

/** shared-m-0 `hI`: notices for a call skipped before it ran; a result starting with one is interrupted. */
const SKIPPED_NOTICE_PREFIXES: readonly string[] = [
	"The user doesn't want to take this action right now. STOP what you are doing and wait for the user to tell you how to proceed.",
	"[Tool call skipped: the turn ended to deliver the message that follows before this call ran. Nothing refused it; re-run it if still needed.]",
	"[Tool call skipped: the turn was stopped before this call ran, by the check whose denial is on another call in this batch. Nothing refused this call and it had no effects; re-run it if still needed.]",
];

/** shared-m-0 `VF`: the refusal notice corrected to say the call was stopped while it ran. */
const STOPPED_WHILE_RUNNING =
	"The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed. Correction to the text above: this call was stopped while running, not refused before it ran. It may have run in part or in full, and its changes may have been written. No permission prompt was involved. Work it started elsewhere (a remote command, a background process) may still be running, so check before starting the same work again. The instruction to stop and wait still stands.";

/** shared-m-0 `jT`. */
const STOPPED_WHILE_RUNNING_NOTICES: ReadonlySet<string> = new Set([
	STOPPED_WHILE_RUNNING,
	STOPPED_WHILE_RUNNING + MEMORY_NOTE,
]);

export interface ToolResultInterruptionInput
{
	/** The result's full text. */
	text: string;
	/** The result record's `toolUseResult`; upstream reads it only when the record holds this one result. */
	toolUseResult?: unknown;
	/** The result record's `toolDenialKind`; likewise read only for a record's lone result. */
	toolDenialKind?: string | undefined;
}

/**
 * Whether an errored result reports an interruption (upstream `vl`): a denial kind of
 * "interrupted" or "cancelled" (`Ml`), a `toolUseResult` of "User rejected tool use", the exact
 * text "Tool execution was interrupted.", text starting with "[Request interrupted by user", an
 * unfinished or skipped-call notice (`ze`), or the stopped-while-running correction (`Be`).
 */
export function isInterruptedToolResult({text, toolUseResult, toolDenialKind}: ToolResultInterruptionInput): boolean
{
	return (
		toolDenialKind === "interrupted" ||
		toolDenialKind === "cancelled" ||
		toolUseResult === USER_REJECTED_TOOL_USE ||
		text === "Tool execution was interrupted." ||
		text.startsWith("[Request interrupted by user") ||
		UNFINISHED_NOTICES.has(text) ||
		SKIPPED_NOTICE_PREFIXES.some((prefix) => text.startsWith(prefix)) ||
		STOPPED_WHILE_RUNNING_NOTICES.has(text.trim())
	);
}
