import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { useToast } from "../components/toast";
import { requestSessionArchived } from "../lib/api/sessions";

const ARCHIVE_FAILED_MESSAGE = "Couldn’t archive the session. Try again.";
const UNARCHIVE_FAILED_MESSAGE = "Couldn’t unarchive the session. Try again.";

/**
 * Archive or unarchive one session. Archiving toasts "Archived 1 session" with
 * [Undo]; neither the request nor the Undo depends on the caller staying
 * mounted, so a row menu that closes on select can still finish the job.
 */
export function useSessionArchive(sessionId: string): (archived: boolean) => void {
  const qc = useQueryClient();
  const toast = useToast();

  return useCallback(
    (archived: boolean) => {
      const unarchive = () => {
        requestSessionArchived(qc, sessionId, false).catch(() => {
          toast({ kind: "error", message: UNARCHIVE_FAILED_MESSAGE });
        });
      };
      if (!archived) {
        unarchive();
        return;
      }
      requestSessionArchived(qc, sessionId, true).then(
        () => {
          toast({
            kind: "success",
            message: "Archived 1 session",
            action: { label: "Undo", onAction: unarchive },
          });
        },
        () => {
          toast({ kind: "error", message: ARCHIVE_FAILED_MESSAGE });
        },
      );
    },
    [qc, sessionId, toast],
  );
}
