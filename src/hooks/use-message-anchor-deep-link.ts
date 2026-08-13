import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { fetchEarlierTranscript } from "../lib/api/sessions";
import { assertNever } from "../lib/assert-never";
import { jumpToMessage } from "../lib/jump-to-message";
import { messageAnchorAction, parseMessageAnchor } from "../lib/message-anchor";

/**
 * Resolve a `#msg-<n>` deep link against the transcript window.
 *
 * The endpoint serves only the tail of a long session, so a link shared weeks
 * ago routinely names a record the client does not hold. Each page that lands
 * moves `windowStartIndex`, which re-runs this effect, so the anchor walks
 * backwards one page at a time until its record is in hand -- and stops on its
 * own once the window reaches the top of the file.
 */
export function useMessageAnchorDeepLink(
  sessionId: string,
  windowStartIndex: number,
  hash: string,
): void {
  const queryClient = useQueryClient();
  const inFlightRef = useRef(false);
  const jumpedToRef = useRef<number | undefined>(undefined);
  const anchorIndex = parseMessageAnchor(hash);

  useEffect(() => {
    if (anchorIndex === undefined) return;
    const action = messageAnchorAction(anchorIndex, windowStartIndex);

    switch (action) {
      case "none":
        return;
      case "jump": {
        // Landing on the anchor is a one-shot. Reading on from there means
        // scrolling up, which auto-loads the previous page and moves
        // `windowStartIndex` -- re-running this effect, which would otherwise
        // snap the reader straight back to the link they arrived on.
        if (jumpedToRef.current === anchorIndex) return;
        jumpedToRef.current = anchorIndex;
        // One frame late so the scroll measures the transcript React has just
        // committed rather than the layout it is replacing.
        const frame = requestAnimationFrame(() => jumpToMessage(anchorIndex));
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
  }, [anchorIndex, windowStartIndex, sessionId, queryClient]);
}
