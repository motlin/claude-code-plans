import { createContext, useContext } from "react";

/**
 * What a jump chip needs to know about the transcript around it.
 *
 * The drawers now list mentions from the whole session while the page holds
 * only a window of it, so a chip can name a message that is not on the page.
 * `windowStartIndex` is how a chip tells the two cases apart, and
 * `requestMessageJump` is how it hands the out-of-window case to the jump that
 * pages history in until the message arrives.
 */
export interface JumpTargetWindow {
  /** Session-absolute JSONL index of the first record the page holds. */
  windowStartIndex: number;
  /** Ask for a message by uuid, or absent when the page cannot page history in. */
  requestMessageJump?: ((uuid: string) => void) | undefined;
}

/**
 * Everything is in-window by default, which is what a chip list rendered
 * outside a session page (a story, a test) should assume.
 */
const JumpTargetContext = createContext<JumpTargetWindow>({ windowStartIndex: 0 });

export const JumpTargetProvider = JumpTargetContext.Provider;

export function useJumpTargetWindow(): JumpTargetWindow {
  return useContext(JumpTargetContext);
}
