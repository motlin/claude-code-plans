import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useSuspenseInfiniteQuery, useSuspenseQuery } from "@tanstack/react-query";
import {
  activeSessionsQueryOptions,
  groupedSessionsQueryOptions,
  recentSessionsInfiniteQueryOptions,
} from "../lib/api/sessions";
import { ListPageHeader } from "../components/list-page-header";
import { SessionProjectGroups } from "../components/session-project-groups";
import { SessionRow } from "../components/session-row";
import { useSettings } from "../components/settings-provider";

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

/**
 * Sessions default to the project grouping the sidebar uses, so the two agree
 * on what "recent" means. The time grouping stays available for the "what did I
 * touch today, across everything" question that cuts across projects.
 */
function SessionsPage() {
  const { settings, setSetting } = useSettings();
  const { data: groups } = useSuspenseQuery(groupedSessionsQueryOptions());
  // Same liveness source as the sidebar's Sessions tree and Active badge, so a
  // session never shows a live dot in one surface and not the other.
  const { data: activeSessions } = useQuery(
    activeSessionsQueryOptions(settings.activeTimeoutSec * 1000),
  );
  const activeIds = new Set((activeSessions ?? []).map((session) => session.sessionId));
  const sessionCount = groups.reduce((total, group) => total + group.sessionCount, 0);

  return (
    <div>
      <ListPageHeader title="Claude Sessions" count={sessionCount} itemLabel="session" />

      <div className="mt-3 flex gap-1 text-xs">
        {(["project", "time"] as const).map((grouping) => (
          <button
            key={grouping}
            type="button"
            onClick={() => setSetting("sessionsGrouping", grouping)}
            className={`cursor-pointer rounded-md px-2.5 py-1 transition-colors ${
              settings.sessionsGrouping === grouping
                ? "bg-bg-300/50 font-medium text-text-000"
                : "text-text-500 hover:bg-bg-300/50 hover:text-text-200"
            }`}
          >
            {grouping === "project" ? "By project" : "By time"}
          </button>
        ))}
      </div>

      {groups.length === 0 ? (
        <p className="mt-4 text-text-500">No session files found.</p>
      ) : (
        <div className="mt-4">
          {settings.sessionsGrouping === "project" ? (
            <SessionProjectGroups groups={groups} activeIds={activeIds} />
          ) : (
            <SessionsByTime activeIds={activeIds} />
          )}
        </div>
      )}
    </div>
  );
}

function SessionsByTime({ activeIds }: { activeIds: ReadonlySet<string> }) {
  const {
    data: recent,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useSuspenseInfiniteQuery(recentSessionsInfiniteQueryOptions());

  const allSessions = recent.pages.flatMap((page) => page.sessions);
  const timePeriodGroups: Array<{ period: string; sessions: typeof allSessions }> = [];
  for (const session of allSessions) {
    const period = getTimePeriod(session.mtime);
    const last = timePeriodGroups[timePeriodGroups.length - 1];
    if (last && last.period === period) {
      last.sessions.push(session);
    } else {
      timePeriodGroups.push({ period, sessions: [session] });
    }
  }

  return (
    <div>
      {timePeriodGroups.map((group) => (
        <section key={group.period}>
          <h2 className="sticky top-0 z-10 border-b border-border-300/15 bg-bg-000 pb-1 pt-2 text-sm font-semibold text-text-500">
            {group.period}
          </h2>
          <ul className="mt-2 mb-4 space-y-1">
            {group.sessions.map((session) => (
              <SessionRow key={session.id} session={session} isActive={activeIds.has(session.id)} />
            ))}
          </ul>
        </section>
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
  );
}
