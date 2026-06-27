import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseInfiniteQuery, useSuspenseQuery } from "@tanstack/react-query";
import {
  groupedSessionsQueryOptions,
  recentSessionsInfiniteQueryOptions,
} from "../lib/api/sessions";
import { useClaudeEvents } from "../hooks/use-claude-events";

export const Route = createFileRoute("/sessions")({
  component: SessionsPage,
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureInfiniteQueryData(recentSessionsInfiniteQueryOptions()),
      queryClient.ensureQueryData(groupedSessionsQueryOptions()),
    ]),
  head: () => ({
    meta: [{ title: "Claude Sessions" }],
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

function getTimePeriod(mtime: string): string {
  const date = new Date(mtime);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffMs =
    startOfToday.getTime() -
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays <= 7) return "Last 7 days";
  if (diffDays <= 30) return "Last 30 days";
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function SessionsPage() {
  const {
    data: recent,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useSuspenseInfiniteQuery(recentSessionsInfiniteQueryOptions());
  const { data: groups } = useSuspenseQuery(groupedSessionsQueryOptions());
  const { activeSessions } = useClaudeEvents();
  const activeIds = new Set(activeSessions.keys());

  const allSessions = recent.pages.flatMap((p) => p.sessions);

  const timePeriodGroups: Array<{
    period: string;
    sessions: typeof allSessions;
  }> = [];
  for (const sess of allSessions) {
    const period = getTimePeriod(sess.mtime);
    const last = timePeriodGroups[timePeriodGroups.length - 1];
    if (last && last.period === period) {
      last.sessions.push(sess);
    } else {
      timePeriodGroups.push({ period, sessions: [sess] });
    }
  }

  return (
    <div>
      <h1 className="text-lg font-semibold">Claude Sessions</h1>

      {allSessions.length === 0 ? (
        <p className="mt-4 text-text-500">No session files found.</p>
      ) : (
        <>
          <div className="mt-6">
            {timePeriodGroups.map((group) => (
              <div key={group.period}>
                <h2 className="sticky top-0 z-10 bg-bg-000 border-b border-border-300/15 pb-1 pt-2 text-sm font-semibold text-text-500">
                  {group.period}
                </h2>
                <ul className="mt-2 mb-4 space-y-1">
                  {group.sessions.map((sess) => (
                    <SessionItem key={sess.id} session={sess} isActive={activeIds.has(sess.id)} />
                  ))}
                </ul>
              </div>
            ))}
            {hasNextPage && (
              <button
                type="button"
                onClick={() => void fetchNextPage()}
                disabled={isFetchingNextPage}
                className="mt-2 text-sm text-accent-100 hover:underline cursor-pointer disabled:opacity-50"
              >
                {isFetchingNextPage ? "Loading…" : "Show more sessions"}
              </button>
            )}
          </div>

          <div className="mt-8">
            <h2 className="border-b border-border-300/15 pb-1 text-sm font-semibold">By Project</h2>
            {groups.map((group) => {
              const shown = group.sessions;
              const remaining = group.sessionCount - shown.length;
              return (
                <div key={group.project} className="mt-4">
                  <h3 className="text-sm font-medium text-text-500">
                    <Link
                      to="/project/$id"
                      params={{ id: group.project }}
                      className="hover:underline"
                    >
                      {group.projectName}
                    </Link>
                    <span className="ml-1.5 text-xs font-normal">({group.sessionCount})</span>
                  </h3>
                  <ul className="mt-1 space-y-1">
                    {shown.map((sess) => (
                      <SessionItem key={sess.id} session={sess} isActive={activeIds.has(sess.id)} />
                    ))}
                  </ul>
                  {remaining > 0 && (
                    <Link
                      to="/project/$id"
                      params={{ id: group.project }}
                      className="mt-1 block px-2 text-xs text-accent-100 hover:underline"
                    >
                      {remaining} more sessions &rarr;
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function SessionItem({
  session,
  isActive,
}: {
  session: {
    id: string;
    title: string;
    summary?: string | undefined;
    mtime: string;
    projectName: string;
    messageCount: number;
    gitBranch?: string | undefined;
  };
  isActive?: boolean;
}) {
  return (
    <li>
      <Link
        to="/session/$id"
        params={{ id: session.id }}
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
          <span className="truncate">{session.title}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-text-500">
          <span>{session.projectName}</span>
          <span>&middot;</span>
          <span>{formatDate(session.mtime)}</span>
          {session.messageCount > 0 && (
            <>
              <span>&middot;</span>
              <span>{session.messageCount} msgs</span>
            </>
          )}
          {session.gitBranch && (
            <>
              <span>&middot;</span>
              <span className="rounded bg-bg-200 px-1.5 py-0.5 font-mono text-[10px]">
                {session.gitBranch}
              </span>
            </>
          )}
        </div>
        {session.summary && session.summary !== session.title && (
          <div className="mt-0.5 truncate text-xs text-text-500 italic">{session.summary}</div>
        )}
      </Link>
    </li>
  );
}
