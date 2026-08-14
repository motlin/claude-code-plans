import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useEffect } from "react";
import {
  activeSessionsQueryOptions,
  groupedSessionsQueryOptions,
  type ProjectSessionGroup,
  type SessionListItem,
} from "../../../lib/api/sessions";
import { SESSION_PROJECT_PREVIEW_LIMIT } from "../../session-project-groups";
import { useSettings } from "../../settings-provider";
import { LoadingBars } from "../primitives/LoadingBars";
import { StatusDot } from "../primitives/StatusDot";

/**
 * Sessions tree, grouped by project and ordered newest-project-first — the same
 * organizing principle `/sessions` uses, so moving between the two surfaces
 * doesn't reshuffle the world. A flat recency list here was unreadable once the
 * machine had more than a handful of projects: the titles read as a jumble of
 * unrelated work with nothing to anchor them to.
 *
 * Liveness comes from ccp's own active-session query rather than
 * `claude agents --json`: that CLI only knows about processes running right
 * now, carries no history, and its `name` slug exists nowhere in the JSONL, so
 * adopting it would decorate a few dozen sessions and leave thousands bare.
 *
 * `collapsedGroups` lives in `Sidebar` because opening an item in another
 * section collapses — and unmounts — this sublist; local state would come back
 * expand-all'd. The group holding the open session reveals itself through
 * `onRevealGroup`, which leaves it collapsible again afterwards.
 */
export function SessionsSubList({
  activeItemId,
  collapsedGroups,
  onToggleGroup,
  onRevealGroup,
}: {
  activeItemId: string | null;
  collapsedGroups: ReadonlySet<string>;
  onToggleGroup: (projectId: string) => void;
  onRevealGroup: (projectId: string) => void;
}) {
  const { settings } = useSettings();
  const { data: groups } = useQuery(groupedSessionsQueryOptions());
  const { data: activeSessions } = useQuery(
    activeSessionsQueryOptions(settings.activeTimeoutSec * 1000),
  );
  const activeIds = new Set((activeSessions ?? []).map((session) => session.sessionId));

  const activeGroupId = groups?.find((group) =>
    group.sessions.some((session) => session.id === activeItemId),
  )?.project;

  // Reveal the group holding the open session once, rather than deriving its
  // expansion — a derived reveal would swallow every click on that group's
  // chevron, the one group the reader is most likely to reach for.
  useEffect(() => {
    if (!activeGroupId) return;
    onRevealGroup(activeGroupId);
  }, [activeGroupId, onRevealGroup]);

  if (groups === undefined) {
    return (
      <div className="pl-10">
        <LoadingBars />
      </div>
    );
  }

  if (groups.length === 0) return null;

  if (groups.length === 1 && groups[0]) {
    return (
      <div className="pl-10">
        <SessionGroupBody group={groups[0]} activeItemId={activeItemId} activeIds={activeIds} />
      </div>
    );
  }

  // The open session's project is always shown, even when it sorts below the
  // cut — the sidebar's job is to say where you are.
  const preview = groups.slice(0, SESSION_PROJECT_PREVIEW_LIMIT);
  const activeGroup = groups.find((group) => group.project === activeGroupId);
  const shown = activeGroup && !preview.includes(activeGroup) ? [...preview, activeGroup] : preview;
  const hiddenProjects = groups.length - shown.length;

  return (
    <div className="pl-10">
      {shown.map((group) => {
        const isExpanded = !collapsedGroups.has(group.project);
        return (
          <div key={group.project}>
            <button
              type="button"
              onClick={() => onToggleGroup(group.project)}
              className="mb-px flex w-full items-center gap-1 rounded-r3 px-2 py-1 text-xs text-t6 transition-colors hover:bg-fill-ghost-hover hover:text-secondary"
            >
              <ChevronRight
                className="h-2.5 w-2.5 shrink-0 transition-transform duration-200"
                style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}
              />
              <span className="truncate font-medium">{group.projectName}</span>
              <span className="ml-auto shrink-0 text-[10px] opacity-60">{group.sessionCount}</span>
            </button>
            {isExpanded && (
              <SessionGroupBody
                group={group}
                activeItemId={activeItemId}
                activeIds={activeIds}
                nested
              />
            )}
          </div>
        );
      })}
      {hiddenProjects > 0 && (
        <Link
          to="/sessions"
          className="mb-px block truncate rounded-r3 px-2 py-1 text-[10px] text-t6 no-underline transition-colors hover:bg-fill-ghost-hover hover:text-secondary"
        >
          {hiddenProjects} more projects &rarr;
        </Link>
      )}
    </div>
  );
}

function SessionGroupBody({
  group,
  activeItemId,
  activeIds,
  nested = false,
}: {
  group: ProjectSessionGroup;
  activeItemId: string | null;
  activeIds: ReadonlySet<string>;
  nested?: boolean;
}) {
  const remaining = group.sessionCount - group.sessions.length;
  return (
    <>
      {group.sessions.map((session) => (
        <SessionLink
          key={session.id}
          session={session}
          isActive={session.id === activeItemId}
          isLive={activeIds.has(session.id)}
          nested={nested}
        />
      ))}
      {remaining > 0 && (
        <Link
          to="/project/$id/sessions"
          params={{ id: group.project }}
          className={`mb-px block truncate rounded-r3 py-1 text-[10px] text-t6 no-underline transition-colors hover:bg-fill-ghost-hover hover:text-secondary ${
            nested ? "pl-5 pr-2" : "px-2"
          }`}
        >
          {remaining} more&hellip;
        </Link>
      )}
    </>
  );
}

function SessionLink({
  session,
  isActive,
  isLive,
  nested,
}: {
  session: SessionListItem;
  isActive: boolean;
  isLive: boolean;
  nested: boolean;
}) {
  return (
    <Link
      to="/session/$id"
      params={{ id: session.id }}
      className={`mb-px flex items-center gap-1.5 rounded-r3 py-1 text-xs no-underline transition-colors ${
        nested ? "pl-5 pr-2" : "px-2"
      } ${
        isActive
          ? "bg-fill-ghost-hover font-medium text-primary"
          : "text-t6 hover:bg-fill-ghost-hover hover:text-secondary"
      }`}
    >
      {isLive && <StatusDot active size="sm" title="Active" />}
      <span className="truncate">{session.title}</span>
    </Link>
  );
}
