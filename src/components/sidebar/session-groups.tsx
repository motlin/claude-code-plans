import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";

import { recentSessionsInfiniteQueryOptions } from "../../lib/api/sessions";
import { usePins } from "../../lib/pin-store";
import { splitPinned } from "../../lib/pinned-sessions";
import {
  buildGroups,
  DEFAULT_SESSION_LIST_PREFS,
  PINNED_GROUP_KEY,
  sessionRowComparator,
  type SessionListPrefs,
} from "../../lib/session-groups";
import { useSidebarState } from "../../lib/sidebar-store";
import { LoadingBars } from "./primitives/LoadingBars";
import { GroupSection, ROW_CLASS, toGroupRow } from "./session-group-section";
import { PinnedSubList } from "./sublists";

/**
 * The sidebar session list, grouped like claude.ai/code's recents: Needs input,
 * Ready for review, Working and Completed by default. Collapsed groups persist in
 * the sidebar store; "Show N more" uncaps a group in place until remount. Pinned
 * sessions move out of their group into the Pinned section above.
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

  const groups = useMemo(
    () => (split === undefined ? undefined : buildGroups(split.rest, prefs, Date.now(), uncapped)),
    [split, prefs, uncapped],
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
      />
      <div data-testid="sidebar-recents" className="flex min-h-[120px] shrink-0 grow flex-col">
        {groups.map((group, index) => (
          <GroupSection
            key={group.key}
            group={group}
            expanded={!collapsed.has(group.key)}
            activeItemId={activeItemId}
            filterSlot={index === 0 ? filterSlot : undefined}
            onShowMore={() => setUncapped((previous) => new Set(previous).add(group.key))}
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
