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
 * A mention outside the loaded window is reachable through its `#msg-<uuid>`
 * deep link, which pages the history in on its way. The records that carry no
 * uuid -- permission-mode switches, pr links, worktree changes -- have no such
 * link: nothing names them but their position, and a hash naming a position
 * scrolls to whatever record sits there today. Those chips say so instead of
 * scrolling somewhere plausible and wrong.
 */
function unreachableReason(
  occurrence: ResourceOccurrence,
  window: JumpTargetWindow,
): string | undefined {
  if (isInWindow(occurrence, window)) return undefined;
  if (occurrence.anchorUuid !== undefined && window.openMessageAnchor !== undefined) {
    return undefined;
  }
  return "This mention is in an earlier part of the session that cannot be linked to.";
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
              // Out of window: hand it to the deep link rather than to the DOM,
              // which holds no row for a message the page has not loaded.
              if (!isInWindow(occurrence, jumpWindow)) {
                if (anchorUuid !== undefined) jumpWindow.openMessageAnchor?.(anchorUuid);
                return;
              }
              jumpToMessage({
                ...(anchorUuid === undefined ? {} : { uuid: anchorUuid }),
                recordIndex: occurrence.anchorIndex,
              });
            }}
            className="inline-flex min-w-6 items-center justify-center rounded-full border border-border-300/20 bg-bg-300 px-1.5 py-0.5 text-[10px] font-medium text-text-300 transition-colors hover:border-accent-100/60 hover:text-text-100 disabled:cursor-not-allowed disabled:border-border-300/10 disabled:text-text-500 disabled:opacity-50"
          >
            {mentionNumber}
          </button>
        );
      })}
    </div>
  );
}
