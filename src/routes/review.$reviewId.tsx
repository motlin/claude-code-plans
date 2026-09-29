import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { reviewQueryOptions } from "../lib/api/reviews";
import { FindingCard } from "../components/finding-card";
import { findingsForDiffLine, parseReviewDiff } from "../lib/review-diff";

export const Route = createFileRoute("/review/$reviewId")({
  component: ReviewPage,
  loader: ({ context: { queryClient }, params }) =>
    queryClient.ensureQueryData(reviewQueryOptions(params.reviewId)),
  head: () => ({ meta: [{ title: "Working-copy review" }] }),
});

function ReviewPage() {
  const { reviewId } = Route.useParams();
  const { data: review } = useSuspenseQuery(reviewQueryOptions(reviewId));
  const files = parseReviewDiff(review.diff);

  return (
    <main className="mx-auto max-w-[min(100%,110rem)] py-6">
      <header className="mb-5">
        <h1 className="text-lg font-semibold text-primary">Working-copy review</h1>
        <p className="mt-1 break-all font-mono text-xs text-t6">{review.cwd}</p>
        {review.summary && <p className="mt-2 max-w-4xl text-sm text-t6">{review.summary}</p>}
      </header>

      {files.length === 0 ? (
        <div className="rounded-md border border-border bg-surface-1 p-4 text-sm text-t6">
          No uncommitted changes were present when this review was created.
        </div>
      ) : (
        <div className="space-y-5">
          {files.map((file) => (
            <section
              key={file.file}
              className="overflow-hidden rounded-md border border-border bg-surface-1"
            >
              <h2 className="border-b border-border px-4 py-2 font-mono text-xs font-semibold text-secondary">
                {file.file}
              </h2>
              <div className="overflow-x-auto">
                <div className="min-w-[60rem]">
                  {file.lines.map((line, index) => {
                    const findings = findingsForDiffLine(review.findings, file.file, line);
                    const background =
                      line.prefix === "+"
                        ? "bg-green-500/10"
                        : line.prefix === "-"
                          ? "bg-red-500/10"
                          : "";
                    return (
                      <div
                        key={`${line.oldLine ?? ""}:${line.newLine ?? ""}:${index}`}
                        className="grid grid-cols-[4rem_4rem_minmax(30rem,1fr)_minmax(18rem,30rem)] border-b border-subtle last:border-b-0"
                      >
                        <span
                          className={`px-2 py-0.5 text-right font-mono text-[11px] text-t6 ${background}`}
                        >
                          {line.oldLine}
                        </span>
                        <span
                          className={`px-2 py-0.5 text-right font-mono text-[11px] text-t6 ${background}`}
                        >
                          {line.newLine}
                        </span>
                        <pre
                          className={`px-2 py-0.5 font-mono text-xs text-secondary ${background}`}
                        >
                          {line.prefix}
                          {line.content}
                        </pre>
                        <div className="border-l border-subtle">
                          {findings.map((finding) => (
                            <FindingCard
                              key={finding.id}
                              anchorId={`finding-${finding.id}`}
                              severity={finding.severity}
                              title={finding.title}
                              body={finding.body}
                              suggestion={finding.suggestion}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
