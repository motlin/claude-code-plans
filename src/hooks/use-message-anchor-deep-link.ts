import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { fetchEarlierTranscript } from "../lib/api/sessions";
import { assertNever } from "../lib/assert-never";
import type { JumpTarget } from "../lib/jump-to-message";
import { jumpToMessage } from "../lib/jump-to-message";
import { messageAnchorAction, parseMessageAnchor } from "../lib/message-anchor";

/**
 * Resolve a `#msg-<uuid>` deep link against the transcript window.
 *
 * The endpoint serves only the tail of a long session, so a link shared weeks
 * ago routinely names a message the client does not hold. Each page that lands
 * grows `uuidToLine`, which re-runs this effect, so the anchor walks backwards
 * one page at a time until its message is in hand -- and stops on its own once
 * the window reaches the top of the file.
 *
 * @param uuidToLine - uuid to record index for every record the client holds,
 *   from `processTranscript`. It answers both questions the anchor asks: is the
 *   message here, and which record is it, for the walk `jumpToMessage` falls
 *   back to when the message renders no row of its own.
 */
export function useMessageAnchorDeepLink(
  sessionId: string,
  windowStartIndex: number,
  hash: string,
  uuidToLine: ReadonlyMap<string, number>,
): void {
  const queryClient = useQueryClient();
  const inFlightRef = useRef(false);
  const jumpedToRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const uuid = parseMessageAnchor(hash);
    if (uuid === undefined) return;
    const action = messageAnchorAction(uuid, {
      startIndex: windowStartIndex,
      uuids: uuidToLine,
    });

    switch (action) {
      case "none":
        return;
      case "jump": {
        // Landing on the anchor is a one-shot. Reading on from there means
        // scrolling up, which auto-loads the previous page and grows
        // `uuidToLine` -- re-running this effect, which would otherwise snap
        // the reader straight back to the link they arrived on.
        if (jumpedToRef.current === hash) return;
        jumpedToRef.current = hash;
        // Pair the uuid with its record index, so a message swallowed by a
        // collapsed row is still reachable from the row that swallowed it.
        const recordIndex = uuidToLine.get(uuid);
        const target: JumpTarget = recordIndex === undefined ? { uuid } : { uuid, recordIndex };
        // One frame late so the scroll measures the transcript React has just
        // committed rather than the layout it is replacing.
        const frame = requestAnimationFrame(() => jumpToMessage(target));
        return () => cancelAnimationFrame(frame);
      }
      case "load-earlier": {
        if (inFlightRef.current) return;
        inFlightRef.current = true;
        void fetchEarlierTranscript(queryClient, sessionId).finally(() => {
          inFlightRef.current = false;
        });
        return;
      }
      default:
        return assertNever(action);
    }
  }, [hash, windowStartIndex, uuidToLine, sessionId, queryClient]);
}
