import { useMemo } from "react";

import { jumpToMessage } from "../lib/jump-to-message";
import type { ResourceOccurrence } from "../lib/session-resources";
import { useJumpTargetWindow, type JumpTargetWindow } from "./jump-target-context";
import { useSettings } from "./settings-provider";

interface JumpChipsProps {
  occurrences: ResourceOccurrence[];
  resourceLabel?: string;
}

function hiddenReason(
  occurrence: ResourceOccurrence,
  settings: { showThinking: boolean; showTools: boolean },
): string | undefined {
  if (occurrence.source === "tool" && !settings.showTools) {
    return "This mention is hidden because tool calls are disabled in display settings.";
  }
  if (occurrence.source === "thinking" && !settings.showThinking) {
    return "This mention is hidden because thinking is disabled in display settings.";
  }
  return undefined;
}

/** Whether the mention's message is on the page, or still on the server. */
function isInWindow(occurrence: ResourceOccurrence, window: JumpTargetWindow): boolean {
  return occurrence.anchorIndex >= window.windowStartIndex;
}

/**
 * Why an out-of-window mention cannot be reached.
 *
 * A mention outside the loaded window is reached by paging history in until its
 * message arrives, which is recognized by uuid. The records that carry no uuid
 * -- permission-mode switches, pr links, worktree changes -- cannot be
 * recognized that way: nothing names them but their position, and the record
 * sitting at a position shifts as history is paged in. Those chips say so
 * instead of scrolling somewhere plausible and wrong.
 */
function unreachableReason(
  occurrence: ResourceOccurrence,
  window: JumpTargetWindow,
): string | undefined {
  if (isInWindow(occurrence, window)) return undefined;
  if (occurrence.anchorUuid !== undefined && window.requestMessageJump !== undefined) {
    return undefined;
  }
  return "This mention is in an earlier part of the session that cannot be reached.";
}

export function JumpChips({ occurrences, resourceLabel = "file" }: JumpChipsProps) {
  const { settings } = useSettings();
  const jumpWindow = useJumpTargetWindow();
  const orderedOccurrences = useMemo(
    () => [...occurrences].sort((left, right) => left.anchorIndex - right.anchorIndex),
    [occurrences],
  );

  return (
    <div className="flex flex-wrap gap-1" aria-label={`${resourceLabel} mentions`}>
      {orderedOccurrences.map((occurrence, index) => {
        const reason =
          hiddenReason(occurrence, settings) ?? unreachableReason(occurrence, jumpWindow);
        const mentionNumber = index + 1;
        const anchorUuid = occurrence.anchorUuid;
        return (
          <button
            key={`${occurrence.anchorIndex}-${occurrence.source}-${occurrence.role}-${occurrence.tool ?? "none"}-${mentionNumber}`}
            type="button"
            disabled={reason !== undefined}
            title={reason ?? `Jump to mention ${mentionNumber}`}
            aria-label={`Jump to ${resourceLabel} mention ${mentionNumber}`}
            onClick={() => {
              // Out of window: hand it to the paging jump rather than to the
              // DOM, which holds no row for a message the page has not loaded.
              if (!isInWindow(occurrence, jumpWindow)) {
                if (anchorUuid !== undefined) jumpWindow.requestMessageJump?.(anchorUuid);
                return;
              }
              jumpToMessage(occurrence.anchorIndex);
            }}
            className="inline-flex min-w-6 items-center justify-center rounded-full border border-strong bg-fill-control px-1.5 py-0.5 text-[10px] font-medium text-secondary transition-colors hover:border-accent-100/60 hover:text-primary disabled:cursor-not-allowed disabled:border-subtle disabled:text-t6 disabled:opacity-50"
          >
            {mentionNumber}
          </button>
        );
      })}
    </div>
  );
}
