import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import type { SessionListItem } from "../../lib/api/sessions";
import type { SessionGroup, SessionGroupRow } from "../../lib/session-groups";
import { toggleSidebarGroup } from "../../lib/sidebar-store";
import { ArchivedBadge } from "../archived-badge";
import { SessionActionsMenu, SessionRowTitle } from "../session-actions-menu";
import { SessionRowStatusDot } from "../session-unread-control";

export interface SidebarSessionRow extends SessionGroupRow {
  id: string;
  session: SessionListItem;
}

export function toGroupRow(session: SessionListItem): SidebarSessionRow {
  return {
    session,
    id: session.id,
    sessionId: session.id,
    title: session.title,
    bucket: session.bucket,
    project: session.projectName,
    archived: session.archived,
    createdAt: Date.parse(session.created),
    lastActivityAt: Date.parse(session.mtime),
  };
}

export const ROW_CLASS =
  "flex h-[var(--sb-row-h)] w-full shrink-0 items-center gap-[var(--sb-row-gap)] rounded-[var(--sb-radius)] px-[var(--sb-row-px)] text-left text-[length:var(--sb-row-font)] no-underline";

/** A collapsible sidebar group: label row (caret on hover), session rows, "Show N more". */
export function GroupSection({
  group,
  expanded,
  activeItemId,
  filterSlot,
  onShowMore,
}: {
  group: SessionGroup<SidebarSessionRow>;
  expanded: boolean;
  activeItemId: string | null;
  filterSlot: ReactNode;
  onShowMore: () => void;
}) {
  return (
    <div data-group-key={group.key} className="group/section relative isolate flex flex-col gap-px">
      <div
        data-sidebar-group-label
        className="group/labelrow df-label-inset flex min-h-[calc(var(--sb-group-pt)+var(--sb-row-h)-4px)] w-full items-center gap-[var(--sb-row-gap)] pt-[var(--sb-group-pt)] pr-[calc((var(--sb-row-h)-24px)/2)] pb-1 text-[length:var(--sb-group-font)] leading-4 text-ink-muted"
      >
        <button
          type="button"
          data-group-toggle
          aria-expanded={expanded}
          onClick={() => toggleSidebarGroup(group.key)}
          className="group/label -my-1 -ml-1 flex min-w-0 flex-1 items-center gap-1 rounded-[var(--sb-radius)] py-1 pl-1 text-left hover:text-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-100"
        >
          <span data-group-name className="min-w-0 truncate">
            {group.label}
          </span>
          <ChevronRight
            aria-hidden="true"
            data-group-caret
            className={`h-3 w-3 shrink-0 transition-transform duration-150 motion-reduce:transition-none ${
              expanded
                ? "rotate-90 opacity-0 group-hover/section:opacity-100 group-focus-visible/label:opacity-100"
                : "opacity-100"
            }`}
          />
        </button>
        {filterSlot}
      </div>
      {expanded && (
        <>
          {group.rows.map((row) => (
            <SessionRowLink
              key={row.sessionId}
              row={row}
              selected={row.sessionId === activeItemId}
            />
          ))}
          {group.hiddenCount > 0 && (
            <button
              type="button"
              data-row
              aria-label={`Show ${group.hiddenCount} more in ${group.label}`}
              onClick={onShowMore}
              className={`${ROW_CLASS} text-ink-muted hover:bg-[var(--sb-hover)] hover:text-secondary`}
            >
              <span className="df-leading-slot" />
              Show {group.hiddenCount} more
            </button>
          )}
        </>
      )}
    </div>
  );
}

function SessionRowLink({ row, selected }: { row: SidebarSessionRow; selected: boolean }) {
  return (
    <SessionActionsMenu session={row.session}>
      <Link
        to="/session/$id"
        params={{ id: row.sessionId }}
        data-row-main-button
        data-selected={selected ? "focused" : undefined}
        className={`${ROW_CLASS} text-secondary hover:bg-[var(--sb-hover)] focus-visible:bg-[var(--sb-hover)] data-[selected=focused]:bg-[var(--sb-selected)] data-[selected=focused]:text-primary`}
      >
        <span className="df-leading-slot text-secondary">
          <SessionRowStatusDot session={row.session} />
        </span>
        <span data-row-label className="min-w-0 flex-1">
          <SessionRowTitle render={(title) => <FadeLabel text={title} />} />
        </span>
        {row.archived && <ArchivedBadge />}
      </Link>
    </SessionActionsMenu>
  );
}

/** Marks itself `data-overflowing` when the title is clipped, so CSS fades its end. */
function FadeLabel({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const measure = () => setOverflowing(element.scrollWidth > element.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text]);

  return (
    <span ref={ref} className="dframe-fade-label" data-overflowing={overflowing ? "" : undefined}>
      <span className="inline-block align-top whitespace-nowrap">{text}</span>
    </span>
  );
}
