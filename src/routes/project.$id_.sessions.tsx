import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ArrowLeft, GitBranch, X } from "lucide-react";
import { useMemo } from "react";
import { z } from "zod";
import { projectDetailQueryOptions, projectSessionsQueryOptions } from "../lib/api/projects";
import { DetailTopBar, pillStyles } from "../components/detail-top-bar";
import { useClaudeEvents } from "../hooks/use-claude-events";
import { formatCount } from "../lib/pluralize";

const sessionsSearchSchema = z.object({
  branch: z.string().optional(),
});

export const Route = createFileRoute("/project/$id_/sessions")({
  component: ProjectSessionsPage,
  validateSearch: sessionsSearchSchema,
  loader: async ({ context: { queryClient }, params }) => {
    const [detail] = await Promise.all([
      queryClient.ensureQueryData(projectDetailQueryOptions(params.id)),
      queryClient.ensureQueryData(projectSessionsQueryOptions(params.id)),
    ]);
    return detail;
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData ? `${loaderData.name} sessions` : "Project Not Found",
      },
    ],
  }),
});

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ProjectSessionsPage() {
  const { id } = Route.useParams();
  const { data: project } = useSuspenseQuery(projectDetailQueryOptions(id));
  const { data: allSessions } = useSuspenseQuery(projectSessionsQueryOptions(id));
  const { branch } = Route.useSearch();
  const navigate = useNavigate();
  const { activeSessions } = useClaudeEvents();
  const activeIds = new Set(activeSessions.keys());

  const sessions = useMemo(
    () => (branch ? allSessions.filter((s) => s.gitBranch === branch) : allSessions),
    [allSessions, branch],
  );

  const uniqueBranches = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of allSessions) {
      if (s.gitBranch) {
        counts.set(s.gitBranch, (counts.get(s.gitBranch) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [allSessions]);

  if (!project) {
    return (
      <div>
        <DetailTopBar>
          <Link to="/projects" className={pillStyles.primary}>
            <ArrowLeft className="h-3.5 w-3.5" />
            All Projects
          </Link>
        </DetailTopBar>
        <h1 className="mt-4 text-lg font-semibold">Project Not Found</h1>
      </div>
    );
  }

  return (
    <div>
      <DetailTopBar>
        <Link to="/project/$id" params={{ id: project.id }} className={pillStyles.primary}>
          <ArrowLeft className="h-3.5 w-3.5" />
          {project.name}
        </Link>
      </DetailTopBar>

      <h1 className="text-lg font-semibold">{project.name} sessions</h1>
      <p className="mt-0.5 text-xs text-text-500">
        {sessions.length} {sessions.length === 1 ? "session" : "sessions"}
        {branch && ` on ${branch}`}
      </p>

      {uniqueBranches.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {branch && (
            <button
              type="button"
              onClick={() => void navigate({ to: ".", search: {}, replace: true })}
              className="flex items-center gap-1 rounded-full bg-accent-main-100 px-2 py-0.5 text-[11px] font-medium text-oncolor-100 transition-colors hover:bg-accent-main-200"
            >
              <GitBranch className="h-3 w-3" />
              {branch}
              <X className="h-3 w-3" />
            </button>
          )}
          {!branch &&
            uniqueBranches.slice(0, 12).map(([b, count]) => (
              <button
                key={b}
                type="button"
                onClick={() =>
                  void navigate({
                    to: ".",
                    search: { branch: b },
                    replace: true,
                  })
                }
                className="flex items-center gap-1 rounded-full border border-border-300 px-2 py-0.5 text-[11px] text-text-300 transition-colors hover:bg-bg-200"
              >
                <GitBranch className="h-3 w-3" />
                {b}
                <span className="text-text-400">({count})</span>
              </button>
            ))}
        </div>
      )}

      {sessions.length === 0 ? (
        <p className="mt-4 text-text-500">No sessions for this project.</p>
      ) : (
        <ul className="mt-4 space-y-1">
          {sessions.map((sess) => {
            const isActive = activeIds.has(sess.id);
            return (
              <li key={sess.id}>
                <Link
                  to="/session/$id"
                  params={{ id: sess.id }}
                  className="block rounded-md p-2 cursor-pointer transition-colors hover:bg-bg-200/50"
                >
                  <div
                    className="flex items-center gap-1.5 truncate"
                    style={{ fontSize: "14px", fontWeight: 430 }}
                  >
                    {isActive && (
                      <span
                        className="inline-block h-2 w-2 shrink-0 rounded-full bg-success-000"
                        title="Active"
                      />
                    )}
                    <span className="truncate">{sess.title}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-text-500">
                    <span>{formatDate(sess.mtime)}</span>
                    {sess.messageCount > 0 && (
                      <>
                        <span>&middot;</span>
                        <span>{formatCount(sess.messageCount, "msg")}</span>
                      </>
                    )}
                    {sess.subagentCount > 0 && (
                      <>
                        <span>&middot;</span>
                        <span>{formatCount(sess.subagentCount, "subagent")}</span>
                      </>
                    )}
                    {sess.gitBranch && (
                      <>
                        <span>&middot;</span>
                        <span className="rounded bg-bg-200 px-1.5 py-0.5 font-mono text-[10px]">
                          {sess.gitBranch}
                        </span>
                      </>
                    )}
                  </div>
                  {sess.summary && sess.summary !== sess.title && (
                    <div className="mt-0.5 truncate text-xs text-text-500 italic">
                      {sess.summary}
                    </div>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
