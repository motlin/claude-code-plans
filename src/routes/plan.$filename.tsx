import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { MarkdownView } from "../components/markdown-view";
import { planQueryOptions, planLinksQueryOptions } from "../lib/api/plans";
import { fromMdSlug } from "../lib/md-slug";
import { stripLeadingTitleHeading } from "../lib/markdown-utils";
import { ArrowLeft, Pencil, FolderOpen, MessageSquare, Clock } from "lucide-react";
import { DetailTopBar, pillStyles } from "../components/detail-top-bar";
import { DebugLink } from "../components/debug-link";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

export const Route = createFileRoute("/plan/$filename")({
  component: PlanPage,
  loader: ({ context: { queryClient }, params }) =>
    Promise.all([
      queryClient.ensureQueryData(planQueryOptions(params.filename)),
      queryClient.ensureQueryData(planLinksQueryOptions(params.filename)),
    ]),
  head: ({ params }) => ({
    meta: [{ title: fromMdSlug(params.filename) }],
  }),
});

function PlanPage() {
  const { filename: slug } = Route.useParams();
  const filename = fromMdSlug(slug);
  const { data: plan } = useSuspenseQuery(planQueryOptions(slug));
  const { data: links } = useSuspenseQuery(planLinksQueryOptions(slug));

  if (!plan) {
    return (
      <div>
        <DetailTopBar>
          <Link to="/plans" className={pillStyles.primary}>
            <ArrowLeft className="h-3.5 w-3.5" />
            All Plans
          </Link>
        </DetailTopBar>
        <h1 className="mt-4 text-lg font-semibold">Plan Not Found</h1>
        <p className="mt-2 text-text-500">This plan could not be found.</p>
      </div>
    );
  }

  const body = stripLeadingTitleHeading(plan.markdown);

  return (
    <div>
      <DetailTopBar>
        <Link to="/plans" className={pillStyles.primary}>
          <ArrowLeft className="h-3.5 w-3.5" />
          All Plans
        </Link>
        <Link to="/plan/$filename/edit" params={{ filename: slug }} className={pillStyles.outline}>
          <Pencil className="h-3 w-3" />
          Edit
        </Link>
        <DebugLink kind="plan" relativePath={filename} />
      </DetailTopBar>
      {plan.mtime && (
        <div className="mt-3 flex items-center gap-1.5 text-xs text-text-500">
          <Clock className="h-3 w-3" />
          Last modified {formatDate(plan.mtime)}
        </div>
      )}
      <h1 className="text-lg font-semibold">{plan.title}</h1>
      <p className="text-xs text-text-500">{filename}</p>
      <div className="mt-4">
        <MarkdownView markdown={body} />
      </div>

      {links.length > 0 && (
        <section className="mt-8 border-t border-border-300/15 pt-6">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-400">
            Related Sessions
          </h2>
          {(() => {
            const byProject = new Map<string, { projectName: string; sessions: typeof links }>();
            for (const link of links) {
              const key = link.project;
              if (!byProject.has(key)) {
                byProject.set(key, {
                  projectName: link.projectName,
                  sessions: [],
                });
              }
              byProject.get(key)!.sessions.push(link);
            }
            return [...byProject.entries()].map(([projectId, group]) => (
              <div key={projectId} className="mt-3">
                <Link
                  to="/project/$id"
                  params={{ id: projectId }}
                  className="mb-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-text-200 no-underline transition-colors hover:bg-bg-200/50"
                >
                  <FolderOpen className="h-3.5 w-3.5 shrink-0 text-text-400" />
                  {group.projectName}
                  <span className="ml-auto text-[10px] text-text-500">
                    {group.sessions.length} {group.sessions.length === 1 ? "session" : "sessions"}
                  </span>
                </Link>
                <div className="space-y-px pl-4">
                  {group.sessions.map((link) => (
                    <Link
                      key={link.sessionId}
                      to="/session/$id"
                      params={{ id: link.sessionId }}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-text-300 no-underline transition-colors hover:bg-bg-200/50 hover:text-text-100"
                    >
                      <MessageSquare className="h-3 w-3 shrink-0 text-text-500" />
                      <span className="truncate">{link.sessionTitle || "Untitled session"}</span>
                    </Link>
                  ))}
                </div>
              </div>
            ));
          })()}
        </section>
      )}
    </div>
  );
}
