const MAX_PRECEDING_INDICES = 50;
const HIGHLIGHT_DURATION_MS = 2_000;

export const TRANSCRIPT_JUMP_REQUEST_EVENT = "transcript-jump-request";

export const TRANSCRIPT_RELEASE_END_FOLLOW_EVENT = "transcript-release-end-follow";

/**
 * Tell the transcript in `scroller` to stop following its end, as a reader's own upward scroll
 * does. A jump made while the transcript still follows its end is otherwise pulled back down by
 * the next row measurement.
 */
export function releaseEndFollow(scroller: Element): void {
	scroller.dispatchEvent(new Event(TRANSCRIPT_RELEASE_END_FOLLOW_EVENT, {bubbles: true}));
}

const HIGHLIGHT_CLASS = "message-highlight";

function flash(element: Element): true {
	element.scrollIntoView({block: "center", behavior: "smooth"});
	element.classList.add(HIGHLIGHT_CLASS);
	setTimeout(() => {
		element.classList.remove(HIGHLIGHT_CLASS);
	}, HIGHLIGHT_DURATION_MS);
	return true;
}

/** Drop the jump flash from every row in `root`, for a jump that lands on something other than the flashed row. */
export function clearJumpFlash(root: Element): void {
	for (const element of root.querySelectorAll(`.${HIGHLIGHT_CLASS}`)) element.classList.remove(HIGHLIGHT_CLASS);
}

/**
 * Scroll to the turn holding the record at `recordIndex` and flash it.
 *
 * Rows are found by the session-absolute record index they carry, which is the
 * only thing that names one: turns carry no id and no URL of their own, the way
 * upstream claude.ai/code renders them. Not every record renders its own row
 * either -- a run of tool calls collapses into one row carrying the run's first
 * record, bash output folds into the command above it, and tool_result records
 * render nothing at all -- so walk backwards a bounded distance to find the row
 * that swallowed it. Returns false when nothing matched, which is also what a
 * jump into a record the client has not paged in yet does, and is why the
 * caller must not treat false as "close enough".
 */
export function jumpToMessage(recordIndex: number): boolean {
	for (let offset = 0; offset <= MAX_PRECEDING_INDICES; offset += 1) {
		const candidateIndex = recordIndex - offset;
		if (candidateIndex < 0) break;

		const element = document.querySelector(`[data-record-index="${candidateIndex}"]`);
		if (element) return flash(element);
	}

	window.dispatchEvent(new CustomEvent<number>(TRANSCRIPT_JUMP_REQUEST_EVENT, {detail: recordIndex}));

	return false;
}
