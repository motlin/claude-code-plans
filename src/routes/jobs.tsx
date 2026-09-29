import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { jobsQueryOptions } from "../lib/api/jobs";
import type { Job, JobState } from "../lib/jobs";
import { formatNarrowRelativeTime } from "../lib/relative-time";
import { jobChildKindLabels, jobStateLabels } from "../lib/schema-choices";

export const Route = createFileRoute("/jobs")({
  component: JobsPage,
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(jobsQueryOptions),
  head: () => ({
    meta: [{ title: "Background jobs" }],
  }),
});

const STATE_PILL_CLASSES = {
  working: "bg-accent-900 text-accent-000",
  running: "bg-accent-900 text-accent-000",
  blocked: "bg-warning-100/15 text-warning-000",
  done: "bg-success-900 text-success-000",
  failed: "bg-danger-900 text-danger-000",
} satisfies Record<JobState, string>;

/**
 * Read-only list of the CLI's background jobs in `~/.claude/jobs`, the local
 * analogue of claude.ai's Dispatch Tasks panel. Each row links to the job's
 * session transcript when its `linkScanPath` names one.
 */
function JobsPage() {
  const { data: jobs } = useSuspenseQuery(jobsQueryOptions);
  const now = useMemo(() => Date.now(), [jobs]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col">
      <header className="flex min-h-12 items-center pb-6 md:min-h-16 md:items-end">
        <h1 className="min-w-0 font-voice text-[28px]/[36px] font-medium text-primary">
          Background jobs
        </h1>
      </header>

      <div className="flex flex-col pb-12 pt-1">
        {jobs.length > 0 ? (
          <ul role="list" aria-label="Background jobs" className="-mx-3 flex flex-col">
            {jobs.map((job) => (
              <JobRow key={job.id} job={job} now={now} />
            ))}
          </ul>
        ) : (
          <div role="status" className="py-16 text-center text-body text-ink-muted">
            Background jobs you start from Claude Code appear here.
          </div>
        )}
      </div>
    </div>
  );
}

function StatePill({ state }: { state: JobState }) {
  return (
    <span
      data-job-state=""
      className={`inline-flex h-5 shrink-0 items-center rounded-r3 px-[5px] text-caption ${STATE_PILL_CLASSES[state]}`}
    >
      {jobStateLabels[state]}
    </span>
  );
}

function JobRow({ job, now }: { job: Job; now: number }) {
  const timeline = [...job.timeline].reverse();
  return (
    <li className="group/cdsrow relative">
      {job.sessionId !== null && (
        <Link
          to="/session/$id"
          params={{ id: job.sessionId }}
          data-primary="true"
          aria-label={job.name}
          className="absolute inset-0 rounded outline-none focus-visible:ring-2 focus-visible:ring-accent-100"
        />
      )}
      <div className="pointer-events-none grid grid-cols-[minmax(0,1fr)_max-content] items-start gap-x-3 rounded px-3 py-2 group-hover/cdsrow:bg-fill-ghost-hover group-has-[:focus-visible]/cdsrow:bg-fill-ghost-hover">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <span
              data-job-title=""
              title={job.intent}
              className="min-w-0 truncate text-body text-primary"
            >
              {job.name}
            </span>
            <StatePill state={job.state} />
          </div>
          <span data-job-detail="" className="min-w-0 truncate text-footnote text-secondary">
            {job.needs ?? job.detail}
          </span>
          {job.result !== null && (
            <span data-job-result="" className="min-w-0 text-footnote text-primary">
              {job.result}
            </span>
          )}
          {job.children.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {job.children.map((child) => (
                <a
                  key={`${child.kind}:${child.id}`}
                  href={child.href}
                  target="_blank"
                  rel="noreferrer"
                  className="pointer-events-auto relative max-w-56 truncate rounded-full border border-border px-2 py-0.5 text-caption text-secondary no-underline transition-colors hover:bg-fill-ghost-hover hover:text-primary"
                >
                  {child.title ?? `${jobChildKindLabels[child.kind]} ${child.id}`}
                </a>
              ))}
            </div>
          )}
          {timeline.length > 0 && (
            <details className="pointer-events-auto relative pt-1 text-footnote text-secondary">
              <summary className="w-fit cursor-pointer select-none hover:text-primary">
                Timeline ({timeline.length})
              </summary>
              <ol className="flex flex-col gap-1 pt-1">
                {timeline.map((entry, index) => (
                  <li key={index} className="flex min-w-0 items-center gap-2">
                    <StatePill state={entry.state} />
                    <span data-job-timeline-detail="" className="min-w-0 truncate">
                      {entry.detail}
                    </span>
                    <time
                      dateTime={new Date(entry.at).toISOString()}
                      className="ms-auto shrink-0 tabular-nums text-ink-muted"
                    >
                      {formatNarrowRelativeTime(entry.at, now)}
                    </time>
                  </li>
                ))}
              </ol>
            </details>
          )}
        </div>
        <time
          data-job-time=""
          dateTime={new Date(job.updatedAt).toISOString()}
          title={new Date(job.updatedAt).toLocaleString()}
          className="text-footnote tabular-nums text-secondary"
        >
          {formatNarrowRelativeTime(job.updatedAt, now)}
        </time>
      </div>
    </li>
  );
}
