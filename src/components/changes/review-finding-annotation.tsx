import type { ReviewFinding } from "../../lib/review-diff";
import { FindingCard } from "../finding-card";
import type { DiffFileAnnotation } from "./diff-file";

export interface FindingActions {
  onFix: (finding: ReviewFinding) => void;
  onDismiss: (finding: ReviewFinding) => void;
}

const ACTION_BUTTON =
  "h-6 cursor-pointer rounded-r5 px-2 text-footnote text-secondary transition-colors hover:bg-fill-ghost-hover hover:text-primary";

/** A working-copy review finding under its diff line, with upstream's "Fix this one" and "Dismiss finding". */
function ReviewFindingAnnotation({
  finding,
  actions,
}: {
  finding: ReviewFinding;
  actions: FindingActions;
}) {
  return (
    <div data-review-finding={finding.id} className="px-2 py-1 font-sans">
      <FindingCard
        severity={finding.severity}
        title={finding.title}
        body={finding.body}
        suggestion={finding.suggestion}
      />
      <div className="flex gap-1 px-1">
        <button type="button" onClick={() => actions.onFix(finding)} className={ACTION_BUTTON}>
          Fix this one
        </button>
        <button type="button" onClick={() => actions.onDismiss(finding)} className={ACTION_BUTTON}>
          Dismiss finding
        </button>
      </div>
    </div>
  );
}

/** The unresolved findings for `path` as inline diff annotations. */
export function findingAnnotations(
  findings: readonly ReviewFinding[],
  path: string,
  actions: FindingActions,
): DiffFileAnnotation[] {
  return findings
    .filter((finding) => !finding.resolved && finding.file === path)
    .map((finding) => ({
      side: finding.side === "old" ? "deletions" : "additions",
      lineNumber: finding.endLine ?? finding.line,
      content: <ReviewFindingAnnotation key={finding.id} finding={finding} actions={actions} />,
    }));
}
