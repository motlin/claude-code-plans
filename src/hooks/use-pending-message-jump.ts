import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchEarlierTranscript } from "../lib/api/sessions";
import { jumpToMessage } from "../lib/jump-to-message";

/** A request to reach one message, numbered so asking twice jumps twice. */
interface PendingJump {
  uuid: string;
  requestId: number;
}

/**
 * Jump to a message that may not be loaded yet, paging history in until it is.
 *
 * The endpoint serves only the tail of a long session, so a drawer listing the
 * whole session routinely names a message the client does not hold. The request
 * is held in state rather than in the URL: a session is addressed as a whole,
 * the way upstream claude.ai/code addresses one, so nothing finer than the
 * session survives being copied out of the address bar. Each page that lands
 * grows `uuidToLine`, which re-runs this effect, so the request walks backwards
 * one page at a time until its message is in hand -- and gives up on its own
 * once the window reaches the top of the file.
 *
 * @param uuidToLine - uuid to record index for every record the client holds,
 *   from `processTranscript`. It answers both questions the request asks: is the
 *   message here, and which record is it, since a record index is what names a
 *   row on the page.
 * @returns Request a jump to the message carrying this uuid.
 */
export function usePendingMessageJump(
  sessionId: string,
  windowStartIndex: number,
  uuidToLine: ReadonlyMap<string, number>,
): (uuid: string) => void {
  const queryClient = useQueryClient();
  const inFlightRef = useRef(false);
  const jumpedRequestRef = useRef<number | undefined>(undefined);
  const requestCountRef = useRef(0);
  const [pending, setPending] = useState<PendingJump | undefined>(undefined);

  useEffect(() => {
    if (pending === undefined) return;
    // Landing on the message is a one-shot. Reading on from there means
    // scrolling up, which auto-loads the previous page and grows `uuidToLine`
    // -- re-running this effect, which would otherwise snap the reader straight
    // back to where they jumped in.
    if (jumpedRequestRef.current === pending.requestId) return;

    const recordIndex = uuidToLine.get(pending.uuid);
    if (recordIndex === undefined) {
      // `windowStartIndex === 0` is the terminating case: the whole file is
      // loaded, so the message simply does not belong to this session.
      if (windowStartIndex === 0 || inFlightRef.current) return;
      inFlightRef.current = true;
      void fetchEarlierTranscript(queryClient, sessionId).finally(() => {
        inFlightRef.current = false;
      });
      return;
    }

    jumpedRequestRef.current = pending.requestId;
    // One frame late so the scroll measures the transcript React has just
    // committed rather than the layout it is replacing.
    const frame = requestAnimationFrame(() => jumpToMessage(recordIndex));
    return () => cancelAnimationFrame(frame);
  }, [pending, windowStartIndex, uuidToLine, sessionId, queryClient]);

  return useCallback((uuid: string) => {
    requestCountRef.current += 1;
    setPending({ uuid, requestId: requestCountRef.current });
  }, []);
}
