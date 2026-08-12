import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { ProjectSessionGroup } from "../lib/api/sessions";
import { formatRelativeTimeFromIso } from "../lib/relative-time";
import { SessionRow } from "./session-row";

/**
 * Projects shown before the surface asks whether you really want the rest. A
 * machine that has been in use for a while accumulates dozens of project
 * directories, most of them long finished; rendering all of them buries the
 * handful actually in flight.
 */
export const SESSION_PROJECT_PREVIEW_LIMIT = 10;

function lastActivity(group: ProjectSessionGroup): string | null {
  const newest = group.sessions[0];
  return newest ? formatRelativeTimeFromIso(newest.mtime) : null;
}

/**
 * Project-grouped session list — the shared organizing principle behind both
 * `/sessions` and the sidebar's Sessions tree: projects ordered by most-recent
 * activity, sessions newest-first inside each project. The server hands the
 * groups back in that order, so this renders them as given rather than
 * re-sorting and risking a different answer than the sidebar's.
 */
export function SessionProjectGroups({
  groups,
  activeIds,
}: {
  groups: ProjectSessionGroup[];
  activeIds: ReadonlySet<string>;
}) {
  const [showAllProjects, setShowAllProjects] = useState(false);
  const shown = showAllProjects ? groups : groups.slice(0, SESSION_PROJECT_PREVIEW_LIMIT);
  const hiddenProjects = groups.length - shown.length;

  return (
    <div>
      {shown.map((group) => {
        const remaining = group.sessionCount - group.sessions.length;
        const activeCount = group.sessions.filter((session) => activeIds.has(session.id)).length;
        const relative = lastActivity(group);
        return (
          <section key={group.project} className="mt-5 first:mt-0">
            <h2 className="sticky top-0 z-10 flex items-baseline gap-2 border-b border-border-300/15 bg-bg-000 pb-1 pt-2 text-sm font-semibold">
              <Link to="/project/$id" params={{ id: group.project }} className="hover:underline">
                {group.projectName}
              </Link>
              <span className="text-xs font-normal text-text-500">{group.sessionCount}</span>
              {activeCount > 0 && (
                <span className="text-xs font-normal text-success-000">{activeCount} live</span>
              )}
              {relative && (
                <span className="ml-auto text-xs font-normal text-text-500">{relative}</span>
              )}
            </h2>
            <ul className="mt-1 space-y-1">
              {group.sessions.map((session) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  isActive={activeIds.has(session.id)}
                  showProject={false}
                />
              ))}
            </ul>
            {remaining > 0 && (
              <Link
                to="/project/$id/sessions"
                params={{ id: group.project }}
                className="mt-1 block px-2 text-xs text-accent-100 hover:underline"
              >
                {remaining} more sessions &rarr;
              </Link>
            )}
          </section>
        );
      })}
      {hiddenProjects > 0 && (
        <button
          type="button"
          onClick={() => setShowAllProjects(true)}
          className="mt-5 cursor-pointer text-sm text-accent-100 hover:underline"
        >
          Show {hiddenProjects} more projects
        </button>
      )}
    </div>
  );
}
