import { useMemo } from "react";

import { jumpToMessage } from "../lib/jump-to-message";
import type { ResourceOccurrence } from "../lib/session-resources";
import { useSettings } from "./settings-provider";

interface JumpChipsProps {
  occurrences: ResourceOccurrence[];
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

export function JumpChips({ occurrences }: JumpChipsProps) {
  const { settings } = useSettings();
  const orderedOccurrences = useMemo(
    () => [...occurrences].sort((left, right) => left.lineArrayIndex - right.lineArrayIndex),
    [occurrences],
  );

  return (
    <div className="flex flex-wrap gap-1" aria-label="File mentions">
      {orderedOccurrences.map((occurrence, index) => {
        const reason = hiddenReason(occurrence, settings);
        const mentionNumber = index + 1;
        return (
          <button
            key={`${occurrence.lineArrayIndex}-${occurrence.source}-${occurrence.role}-${occurrence.tool ?? "none"}-${mentionNumber}`}
            type="button"
            disabled={reason !== undefined}
            title={reason ?? `Jump to mention ${mentionNumber}`}
            aria-label={`Jump to file mention ${mentionNumber}`}
            onClick={() => jumpToMessage(occurrence.lineArrayIndex)}
            className="inline-flex min-w-6 items-center justify-center rounded-full border border-border-300/20 bg-bg-300 px-1.5 py-0.5 text-[10px] font-medium text-text-300 transition-colors hover:border-accent-100/60 hover:text-text-100 disabled:cursor-not-allowed disabled:border-border-300/10 disabled:text-text-500 disabled:opacity-50"
          >
            {mentionNumber}
          </button>
        );
      })}
    </div>
  );
}
