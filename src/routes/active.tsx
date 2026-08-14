import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { z } from "zod";
import { ActiveSessionListResponse, activeSessionsQueryOptions } from "../lib/api/sessions";
import { useClaudeEvents } from "../hooks/use-claude-events";
import { DEFAULTS, useSettings } from "../components/settings-provider";
import { NeedsReviewMarker, SessionReviewAction } from "../components/session-reviewed-toggle";
import { SessionStatusIndicator } from "../components/session-status-indicator";
import { ListPageHeader } from "../components/list-page-header";
import { displayState, waitHeat } from "../lib/session-state";
import { hasUnseenWork, markSeen, subscribeUnseenWork } from "../lib/unread-store";

type ActiveSession = z.infer<typeof ActiveSessionListResponse>[number];

export const Route = createFileRoute("/active")({
  component: ActivePage,
  loader: ({ context: { queryClient } }) =>
    queryClient.ensureQueryData(activeSessionsQueryOptions(DEFAULTS.activeTimeoutSec * 1000)),
  head: () => ({
    meta: [{ title: "Active Sessions" }],
  }),
});

function formatRelativeTime(lastModified: number): string {
  const diffMs = Date.now() - lastModified;
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `modified ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return `modified ${minutes}m ago`;
}

/**
 * Same fixed-column row treatment as the Herdr list: every column but the title
 * is fixed-width, and the trailing review-action column is reserved even when a
 * row has nothing to review, so dots, status words, and timestamps line up down
 * the whole list. The columns themselves are session-scoped — /active is fed by
 * `/api/sessions/active` alone and stays readable with no terminal multiplexer
 * running at all.
 */
const ACTIVE_ROW_COLUMNS =
  "grid grid-cols-[minmax(0,1fr)_5rem_8.5rem_7rem_9rem] items-center rounded-md border border-border";

const ACTIVE_TRANSCRIPT_COLUMNS =
  "grid grid-cols-[minmax(0,1fr)_minmax(0,8rem)] items-center gap-1.5 rounded-md p-3 no-underline transition-colors hover:bg-surface-0/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-100";

function labelFromCwd(cwd: string): string {
  const trimmed = cwd.replace(/\/+$/, "");
  const base = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  return base || cwd;
}

function ActivePage() {
  const { settings } = useSettings();
  const [now, setNow] = useState(Date.now);
  const [, setUnseenWorkVersion] = useState(0);
  const activeTimeoutMs = settings.activeTimeoutSec * 1000;
  const { data: loaderSessions } = useSuspenseQuery(activeSessionsQueryOptions(activeTimeoutMs));
  const { activeSessions } = useClaudeEvents();

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setUnseenWorkVersion((version) => version + 1);
    return subscribeUnseenWork(() => setUnseenWorkVersion((version) => version + 1));
  }, []);

  // Union of the loader result and the SSE reducer map. Loader entries carry full
  // info (projectName, projectDir) and get their timestamp patched from the reducer;
  // reducer-only entries (a session that just became active before the refetch lands)
  // are surfaced with a display label derived from their cwd.
  const merged = new Map<string, ActiveSession>();
  for (const s of loaderSessions) {
    const pushed = activeSessions.get(s.sessionId);
    merged.set(s.sessionId, pushed ? { ...s, lastModified: pushed.lastActivity } : s);
  }
  for (const [sessionId, info] of activeSessions) {
    if (merged.has(sessionId)) continue;
    merged.set(sessionId, {
      sessionId,
      projectDir: info.cwd,
      projectName: labelFromCwd(info.cwd),
      title: sessionId,
      createdAt: info.startedAt,
      lastModified: info.lastActivity,
      state: "unknown",
      blockedSince: null,
    });
  }
  const sessions = [...merged.values()].map((session) => ({
    ...session,
    displayState: displayState(session.state, hasUnseenWork(session.sessionId)),
  }));
  // Newest activity first, so the "modified Xs ago" column decreases down the page.
  sessions.sort((first, second) => second.lastModified - first.lastModified);

  return (
    <div>
      <ListPageHeader title="Active Sessions" count={sessions.length} itemLabel="session" />

      {sessions.length === 0 ? (
        <p className="mt-8 text-center text-t6">No active Claude Code sessions</p>
      ) : (
        <div className="mt-4 space-y-1">
          {sessions.map((session) => (
            <div key={session.sessionId} className={ACTIVE_ROW_COLUMNS}>
              <Link
                to="/session/$id"
                params={{ id: session.sessionId }}
                aria-label={`Open session transcript for ${session.title}`}
                title={`Open session transcript for ${session.title}. Project ${session.projectName}`}
                className={ACTIVE_TRANSCRIPT_COLUMNS}
              >
                <span className="truncate text-sm font-medium text-primary">{session.title}</span>
                <span className="truncate text-xs text-t6">{session.projectName}</span>
              </Link>
              <SessionStatusIndicator
                state={session.state}
                heat={waitHeat(session.displayState, session.blockedSince, now)}
              />
              <NeedsReviewMarker needsReview={session.displayState === "review"} />
              <span className="truncate text-xs tabular-nums text-t6">
                {formatRelativeTime(session.lastModified)}
              </span>
              <div className="justify-self-end">
                {session.displayState === "review" && (
                  <SessionReviewAction
                    onReview={async () => {
                      markSeen(session.sessionId);
                    }}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
