import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { z } from "zod";
import { ActiveSessionListResponse, activeSessionsQueryOptions } from "../lib/api/sessions";
import { useClaudeEvents } from "../hooks/use-claude-events";
import { DEFAULTS, useSettings } from "../components/settings-provider";
import { StatusDot } from "../components/sidebar/primitives/StatusDot";
import { ListPageHeader } from "../components/list-page-header";
import {
  compareByStableCreation,
  compareByUrgency,
  displayState,
  waitHeat,
} from "../lib/session-state";
import { hasUnseenWork, subscribeUnseenWork } from "../lib/unread-store";

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
  sessions.sort((first, second) =>
    settings.sessionSort === "stable"
      ? compareByStableCreation(first, second)
      : compareByUrgency(
          { state: first.displayState, lastModified: first.lastModified },
          { state: second.displayState, lastModified: second.lastModified },
        ),
  );

  return (
    <div>
      <ListPageHeader title="Active Sessions" count={sessions.length} itemLabel="session" />

      {sessions.length === 0 ? (
        <p className="mt-8 text-center text-text-500">No active Claude Code sessions</p>
      ) : (
        <div className="mt-4 space-y-1">
          {sessions.map((session) => (
            <Link
              key={session.sessionId}
              to="/session/$id"
              params={{ id: session.sessionId }}
              className="block rounded-md border border-border-300/15 p-3 no-underline transition-colors hover:bg-bg-200/50"
            >
              <div className="flex items-center gap-2">
                <StatusDot
                  active
                  heat={waitHeat(session.displayState, session.blockedSince, now)}
                />
                <span className="truncate text-sm font-medium text-text-000">
                  {session.projectName}
                </span>
                <span className="ml-auto text-xs text-text-500">
                  {formatRelativeTime(session.lastModified)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
