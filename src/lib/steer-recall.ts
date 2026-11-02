import {getComposerText, requestComposerTakeBack} from "./context-attach";
import type {QueuedPrompt} from "./composer-queue";

/**
 * Upstream's `onEscapeRecall`: Esc while working pulls the last steer the browser still holds back into an
 * empty composer, and reports whether it did so the caller can skip the stop. A steer the CLI has already
 * taken isn't in `held`, so it is never recalled; a draft in the composer refuses the recall.
 */
export function recallLastHeldSteer(
	sessionId: string,
	held: readonly QueuedPrompt[],
	remove: (id: string) => void,
): boolean {
	const last = held.at(-1);
	if (last === undefined) return false;
	if ((getComposerText(sessionId) ?? "").trim() !== "") return false;
	if (!requestComposerTakeBack(sessionId, last.text)) return false;
	remove(last.id);
	return true;
}
