import { Pin } from "lucide-react";
import { useState } from "react";

import { PINNED_GROUP_KEY, pinnedGroup } from "../../../lib/session-groups";
import { GroupSection, ROW_CLASS, type SidebarSessionRow } from "../session-group-section";

/**
 * The sidebar Pinned section above the session groups, like claude.ai/code. With no
 * pins and no drag in progress it collapses to an inert zero-height stub that
 * animates open (`df-pin-section-reveal`) once a drag starts.
 */
export function PinnedSubList({
  rows,
  expanded,
  activeItemId,
  dragging = false,
}: {
  /** Pinned sessions, already in display order. */
  rows: SidebarSessionRow[];
  expanded: boolean;
  activeItemId: string | null;
  /** A row drag is in progress, so the section shows a drop row even when empty. */
  dragging?: boolean;
}) {
  const [uncapped, setUncapped] = useState<ReadonlySet<string>>(() => new Set());
  const empty = rows.length === 0;
  const stub = empty && !dragging;

  return (
    <div
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
      />
      {dragging && (expanded || empty) && <PinDropRow />}
    </div>
  );
}

function PinDropRow() {
  return (
    <div data-pin-drop-row className={`${ROW_CLASS} text-ink-muted opacity-80`}>
      <span className="df-leading-slot">
        <Pin aria-hidden="true" className="rotate-6 scale-105" />
      </span>
      Drop here
    </div>
  );
}
