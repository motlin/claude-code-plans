import {useShortcut} from "./use-shortcut";

/** The slice of the transcript virtualizer that prompt jumping needs. */
export interface PromptJumpVirtualizer {
	/** Entry indices of the user prompts, ascending. */
	promptIndices: readonly number[];
	/** Top of an entry, in pixels from the top of the list. */
	entryOffset(index: number): number;
	/** Top edge of the visible transcript, in pixels from the top of the list. */
	viewportOffset(): number;
	/** Scroll so the entry's top sits at the top of the visible transcript. */
	scrollToEntry(index: number): void;
}

type Direction = "previous" | "next";

/** Sub-pixel scroll rounding must not count as "above" or "below" the viewport top. */
const ALIGNMENT_TOLERANCE_PIXELS = 1;

function promptJumpTarget(virtualizer: PromptJumpVirtualizer, direction: Direction): number | undefined {
	const viewportTop = virtualizer.viewportOffset();
	const {promptIndices} = virtualizer;
	if (direction === "previous") {
		return [...promptIndices]
			.reverse()
			.find((index) => virtualizer.entryOffset(index) < viewportTop - ALIGNMENT_TOLERANCE_PIXELS);
	}
	return promptIndices.find((index) => virtualizer.entryOffset(index) > viewportTop + ALIGNMENT_TOLERANCE_PIXELS);
}

function jump(virtualizer: PromptJumpVirtualizer, direction: Direction): boolean {
	const target = promptJumpTarget(virtualizer, direction);
	if (target === undefined) return false;
	virtualizer.scrollToEntry(target);
	return true;
}

/** Bind ⌥⌘↑ / ⌥⌘↓ (Alt+↑ / Alt+↓ off mac) to jump between user prompts. */
export function usePromptJump(virtualizer: PromptJumpVirtualizer): void {
	useShortcut("jump_prev_prompt", () => jump(virtualizer, "previous"));
	useShortcut("jump_next_prompt", () => jump(virtualizer, "next"));
}
