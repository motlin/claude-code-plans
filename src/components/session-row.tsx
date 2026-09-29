import { Link } from "@tanstack/react-router";
import type { SessionListItem } from "../lib/api/sessions";
import { formatCount } from "../lib/pluralize";
import { isLiveSessionState } from "../lib/session-state";
import { SessionActionsMenu, SessionRowTitle } from "./session-actions-menu";
import { SessionRowStatusDot } from "./session-unread-control";
import { SessionStateIcon } from "./status-dot";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * One session in a full-page list. `showProject` is off inside project groups,
 * where repeating the project name on every row is pure noise.
 */
export function SessionRow({
  session,
  isActive,
  showProject = true,
}: {
  session: SessionListItem;
  isActive: boolean;
  showProject?: boolean;
}) {
  return (
    <li>
      <SessionActionsMenu session={session}>
        <Link
          to="/session/$id"
          params={{ id: session.id }}
          className="block rounded-md p-2 pr-36 cursor-pointer transition-colors hover:bg-surface-0/50"
        >
          <div
            className="flex items-center gap-1.5 truncate"
            style={{ fontSize: "14px", fontWeight: 430 }}
          >
            {/* A row the active feed reports live whose summary still says "ended" shows as running. */}
            {isActive &&
              (isLiveSessionState(session.state) ? (
                <SessionRowStatusDot session={session} />
              ) : (
                <SessionStateIcon kind="running" />
              ))}
            <span className="flex min-w-0 flex-1 truncate">
              <SessionRowTitle />
            </span>
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-xs text-t6">
            {showProject && (
              <>
                <span className="min-w-0 shrink truncate">{session.projectName}</span>
                <span className="shrink-0">&middot;</span>
              </>
            )}
            <time dateTime={session.mtime} className="shrink-0">
              {formatDate(session.mtime)}
            </time>
            {session.messageCount > 0 && (
              <>
                <span className="shrink-0">&middot;</span>
                <span className="shrink-0">{formatCount(session.messageCount, "msg")}</span>
              </>
            )}
            {session.gitBranch && (
              <>
                <span className="shrink-0">&middot;</span>
                <span className="max-w-32 shrink truncate rounded bg-surface-0 px-1.5 py-0.5 font-mono text-[10px]">
                  {session.gitBranch}
                </span>
              </>
            )}
            {/* Soaks up the leftover width so the metadata run stays left-aligned
              in both the project and time groupings. */}
            <span className="min-w-0 flex-1" />
          </div>
          {session.summary && session.summary !== session.title && (
            <div className="mt-0.5 truncate text-xs text-t6 italic">{session.summary}</div>
          )}
        </Link>
      </SessionActionsMenu>
    </li>
  );
}
