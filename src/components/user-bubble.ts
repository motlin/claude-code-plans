/**
 * Upstream's `[data-cds=UserMessage]` column (`_w`): full width and pushed to the end, so the bubble, not the
 * column, carries the 85% cap and a short prompt keeps its text width. `gap-g5 comfortable:gap-g6` is upstream's
 * `gap-xs` (6px default, 8px comfortable).
 */
export const USER_MESSAGE_CLASS =
	"group/message-row flex w-full min-w-0 flex-col gap-g5 comfortable:gap-g6 font-sans ms-auto items-end";

/**
 * Upstream's UserMessage bubble: `ck` radius/padding, `text-heading font-normal`, `gap-xs` (6px/8px) and the
 * 85% `--cds-message-bubble-measure` cap, with no overflow clip at rest (only a collapsed body clips).
 * `user-message-bubble` is a local hook for tests and styles, not an upstream class.
 */
function bubbleClass(ink: string, fill: string): string
{
	return `user-message-bubble relative flex min-w-0 flex-col gap-[6px] comfortable:gap-[8px] rounded-r7 comfortable:rounded-card px-3 py-2 comfortable:px-4 comfortable:py-3 text-heading font-normal break-words select-text ${ink} max-w-[85%] ${fill}`;
}

/** Every human prompt bubble: plain, slash command, waiting, sending, held, streaming and plan feedback. */
export const USER_BUBBLE_CLASS = bubbleClass("text-user-msg-text", "bg-user-msg-bg");

/** The automated rows (compaction summary, labeled hook output) swap only the ink pair. */
export const AUTO_BUBBLE_CLASS = bubbleClass("text-auto-msg-text", "bg-auto-msg-bg");
