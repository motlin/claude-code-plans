import { Pin } from "lucide-react";
import { useState } from "react";

import type { SidebarDragRowProps } from "../../../hooks/use-sidebar-drag";
import { PINNED_GROUP_KEY, pinnedGroup } from "../../../lib/session-groups";
import { GroupSection, ROW_CLASS, type SidebarSessionRow } from "../session-group-section";

/** Drop row states: idle (revealed without a drag), a drag in progress, or the pointer over it. */
type PinDropRowState = "idle" | "dragging" | "hot";

const DROP_ROW_LABELS: Record<PinDropRowState, string> = {
  idle: "Drag to pin",
  dragging: "Drop here",
  hot: "Let go",
};

/**
 * The sidebar Pinned section above the session groups, like claude.ai/code. With no
 * pins and no drag in progress it collapses to an inert zero-height stub that
 * animates open (`df-pin-section-reveal`) once a drag starts, showing a drop row.
 */
export function PinnedSubList({
  rows,
  expanded,
  activeItemId,
  dragging = false,
  dropRowHot = false,
  listRef,
  dropRowRef,
  dragRowProps,
}: {
  /** Pinned sessions, already in display order. */
  rows: SidebarSessionRow[];
  expanded: boolean;
  activeItemId: string | null;
  /** A row drag is in progress, so the section shows a drop row even when empty. */
  dragging?: boolean;
  /** The dragged row is over the drop row. */
  dropRowHot?: boolean;
  /** Registers the section as the pinned drag list; its rows are the slots. */
  listRef?: (element: HTMLElement | null) => void;
  /** Registers the drop row as a drag zone. */
  dropRowRef?: (element: HTMLElement | null) => void;
  dragRowProps?: (id: string) => SidebarDragRowProps;
}) {
  const [uncapped, setUncapped] = useState<ReadonlySet<string>>(() => new Set());
  const empty = rows.length === 0;
  const stub = empty && !dragging;
  const pinnedIds = rows.map((row) => row.id);

  return (
    <div
      ref={listRef}
      data-testid="sidebar-pinned"
      data-pinned-list=""
      data-stub={stub ? "" : undefined}
      inert={stub}
      className={`group/section flex shrink-0 flex-col gap-px ${empty ? "df-pin-section-reveal" : ""}`}
    >
      <GroupSection
        group={pinnedGroup(rows, uncapped)}
        expanded={expanded}
        activeItemId={activeItemId}
        filterSlot={null}
        onShowMore={() => setUncapped(new Set([PINNED_GROUP_KEY]))}
        pinnedIds={pinnedIds}
        {...(dragRowProps === undefined ? {} : { dragRowProps })}
      />
      {dragging && <PinDropRow ref={dropRowRef} state={dropRowHot ? "hot" : "dragging"} />}
    </div>
  );
}

function PinDropRow({
  ref,
  state,
}: {
  ref: ((element: HTMLElement | null) => void) | undefined;
  state: PinDropRowState;
}) {
  return (
    <div
      ref={ref}
      data-pin-drop-row
      data-hot={state === "hot" ? "" : undefined}
      className={`${ROW_CLASS} ${state === "hot" ? "bg-[var(--sb-hover)] text-secondary" : "text-ink-muted opacity-80"}`}
    >
      <span className="df-leading-slot">
        <Pin
          aria-hidden="true"
          className={`transition-transform ${state === "idle" ? "" : "rotate-6 scale-105"}`}
        />
      </span>
      {DROP_ROW_LABELS[state]}
    </div>
  );
}
