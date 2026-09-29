import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState, type ReactNode } from "react";

import { type SidebarDrop, useSidebarDrag } from "../../hooks/use-sidebar-drag";
import { recentSessionsInfiniteQueryOptions } from "../../lib/api/sessions";
import { readPinState, unpin, usePins, writePinState } from "../../lib/pin-store";
import { dropOutcome, placePin, splitPinned, type SplitPinned } from "../../lib/pinned-sessions";
import {
  buildGroups,
  DEFAULT_SESSION_LIST_PREFS,
  PINNED_GROUP_KEY,
  sessionRowComparator,
  type SessionListPrefs,
} from "../../lib/session-groups";
import { useSessionGroups } from "../../lib/session-group-store";
import { slotToIndex } from "../../lib/sidebar-drag";
import { useSidebarState } from "../../lib/sidebar-store";
import { assertNever } from "../../lib/assert-never";
import { useToast } from "../toast";
import { LoadingBars } from "./primitives/LoadingBars";
import {
  GroupSection,
  ROW_CLASS,
  type SidebarSessionRow,
  toGroupRow,
} from "./session-group-section";
import { PinnedSubList } from "./sublists";

/**
 * The sidebar session list, grouped like claude.ai/code's recents: Needs input,
 * Ready for review, Working and Completed by default. Collapsed groups persist in
 * the sidebar store; "Show N more" uncaps a group in place until remount. Pinned
 * sessions move out of their group into the Pinned section above. Dragging any row
 * pins it at a Pinned slot, reorders a pinned row, or (dropped below Pinned) unpins it.
 */
export function SessionGroups({
  activeItemId,
  filterSlot,
  prefs = DEFAULT_SESSION_LIST_PREFS,
}: {
  activeItemId: string | null;
  /** Rendered at the end of the first group header, wherever that group is. */
  filterSlot?: ReactNode;
  prefs?: SessionListPrefs;
}) {
  const { data, hasNextPage, isFetchingNextPage, fetchNextPage } = useInfiniteQuery({
    ...recentSessionsInfiniteQueryOptions(undefined, prefs.statusFilter),
    // Keep the current rows (and the filter button) up while a new Status loads.
    placeholderData: keepPreviousData,
  });
  const { collapsedGroups } = useSidebarState();
  const [uncapped, setUncapped] = useState<ReadonlySet<string>>(() => new Set());

  const { pinnedIds, pinnedOrder } = usePins();

  const split = useMemo(() => {
    if (data === undefined) return undefined;
    const rows = data.pages.flatMap((page) => page.sessions.map(toGroupRow));
    return splitPinned(rows, { pinnedIds, pinnedOrder }, sessionRowComparator(prefs.sortBy));
  }, [data, prefs.sortBy, pinnedIds, pinnedOrder]);

  const toast = useToast();
  const latestSplit = useRef<SplitPinned<SidebarSessionRow> | undefined>(undefined);
  latestSplit.current = split;
  const recentsRef = useRef<HTMLDivElement>(null);
  const { drag, rowProps, listRef, zoneRef } = useSidebarDrag({
    onDrop: (drop) => applyPinDrop(drop, () => latestSplit.current, toast),
    getScrollContainer: () => recentsRef.current?.closest("[data-testid=nav-scroll]") ?? null,
  });

  const { groups: customGroups, assignments, order } = useSessionGroups();
  const groups = useMemo(
    () =>
      split === undefined
        ? undefined
        : buildGroups(split.rest, prefs, Date.now(), uncapped, {
            groups: customGroups,
            assignments,
            order,
          }),
    [split, prefs, uncapped, customGroups, assignments, order],
  );

  if (split === undefined || groups === undefined) {
    return (
      <div className="px-2">
        <LoadingBars />
      </div>
    );
  }

  const collapsed = new Set(collapsedGroups);

  return (
    <>
      <PinnedSubList
        rows={split.pinned}
        expanded={!collapsed.has(PINNED_GROUP_KEY)}
        activeItemId={activeItemId}
        dragging={drag !== null}
        dropRowHot={drag?.target?.type === "zone" && drag.target.zoneId === PIN_DROP_ZONE}
        listRef={listRef(PINNED_LIST)}
        dropRowRef={zoneRef(PIN_DROP_ZONE)}
        dragRowProps={rowProps}
      />
      <div
        ref={(element) => {
          recentsRef.current = element;
          zoneRef(UNPIN_ZONE)(element);
        }}
        data-testid="sidebar-recents"
        className="flex min-h-[120px] shrink-0 grow flex-col"
      >
        {groups.map((group, index) => (
          <GroupSection
            key={group.key}
            group={group}
            expanded={!collapsed.has(group.key)}
            activeItemId={activeItemId}
            filterSlot={index === 0 ? filterSlot : undefined}
            onShowMore={() => setUncapped((previous) => new Set(previous).add(group.key))}
            dragRowProps={rowProps}
          />
        ))}
        {hasNextPage && (
          <button
            type="button"
            aria-label="Load more sessions"
            aria-disabled={isFetchingNextPage || undefined}
            onClick={() => void fetchNextPage()}
            className={`${ROW_CLASS} df-label-inset mt-[var(--sb-group-pt)] text-ink-muted hover:bg-[var(--sb-hover)] hover:text-secondary aria-disabled:pointer-events-none aria-disabled:opacity-70`}
          >
            Load more sessions
          </button>
        )}
      </div>
    </>
  );
}

const PINNED_LIST = "pinned";
const PIN_DROP_ZONE = "pin-drop";
/** The recents list below Pinned: dropping a pinned row here unpins it. */
const UNPIN_ZONE = "unpin";

/** Apply a released sidebar row drag to the pins, like claude.ai/code. */
function applyPinDrop(
  { srcId, target }: SidebarDrop,
  getSplit: () => SplitPinned<SidebarSessionRow> | undefined,
  toast: ReturnType<typeof useToast>,
): void {
  const split = getSplit();
  if (split === undefined) return;
  const displayed = split.pinned.map((row) => row.id);
  const srcIdx = displayed.indexOf(srcId);
  let slot: number | null = null;
  if (target.type === "slot" && target.listId === PINNED_LIST) slot = target.slot;
  if (target.type === "zone" && target.zoneId === PIN_DROP_ZONE) slot = displayed.length;
  const outcome = dropOutcome({
    srcPinned: srcIdx !== -1,
    slot,
    belowPinnedBottom: target.type === "zone" && target.zoneId === UNPIN_ZONE,
  });
  switch (outcome) {
    case "pin":
    case "reorder": {
      if (slot === null) return;
      const index = slotToIndex(slot, srcIdx === -1 ? null : srcIdx);
      writePinState(placePin(readPinState(), displayed, srcId, index));
      return;
    }
    case "unpin": {
      const title = split.pinned[srcIdx]?.title ?? srcId;
      unpin(srcId);
      toast({
        kind: "success",
        message: `Unpinned ${title}`,
        action: {
          label: "Undo",
          onAction: () => {
            const pins = readPinState();
            const now = getSplit();
            if (pins.pinnedIds.includes(srcId) || now === undefined) return;
            if (!now.rest.some((row) => row.id === srcId)) return;
            const pinnedNow = now.pinned.map((row) => row.id);
            writePinState(placePin(pins, pinnedNow, srcId, srcIdx));
          },
        },
      });
      return;
    }
    case "cancel":
      return;
    default:
      assertNever(outcome);
  }
}
