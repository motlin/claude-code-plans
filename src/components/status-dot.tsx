import { GitPullRequest } from "lucide-react";
import { sessionStateKindLabels } from "../lib/schema-choices";
import type { GitPrState } from "../lib/pr-status";
import type { SessionStateKind } from "../lib/session-state";

const GIT_PR_STATE_LABELS = {
  opened: "Open",
  draft: "Draft",
  merged: "Merged",
  closed: "Closed",
  conflicting: "Conflicting",
  queued: "Queued",
} satisfies Record<GitPrState, string>;

const DOT_WRAPPER = "flex min-h-3.5 min-w-3.5 shrink-0 items-center justify-center";

/**
 * Upstream claude.ai/code session row icon: a 6px `.status-dot` for live states, a hollow ring
 * for idle, and a git-state coloured pull-request glyph when the session has a PR.
 */
export function SessionStateIcon({
  kind,
  label,
  pr,
}: {
  kind: SessionStateKind;
  label?: string;
  pr?: { number: number; state: GitPrState };
}) {
  if (kind === "pr") {
    const state = pr?.state ?? "opened";
    const prLabel = pr ? `#${pr.number} · ${GIT_PR_STATE_LABELS[state]}` : undefined;
    return (
      <span
        role="img"
        aria-label={label ?? prLabel ?? sessionStateKindLabels.pr}
        className="flex size-5 shrink-0 items-center justify-center"
      >
        <GitPullRequest
          aria-hidden="true"
          data-cds="Icon"
          size={14}
          strokeWidth={2.75}
          style={{ color: `var(--color-git-${state})` }}
        />
      </span>
    );
  }

  const ariaLabel = label ?? sessionStateKindLabels[kind];
  if (kind === "idle") {
    return (
      <span role="img" aria-label={ariaLabel} className={DOT_WRAPPER}>
        <span
          aria-hidden="true"
          className="block size-[6px] rounded-full border border-current text-ink-muted opacity-50"
        />
      </span>
    );
  }

  return (
    <span role="status" aria-label={ariaLabel} className={DOT_WRAPPER}>
      <span className="status-dot" data-kind={kind} />
    </span>
  );
}
