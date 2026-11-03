import {useArchiveSessions} from "../../hooks/use-session-archive";
import type {SessionGroup, SessionGroupRow} from "../../lib/session-groups";
import {familyKey, setSidebarGroupsCollapsed, useSidebarState} from "../../lib/sidebar-store";
import {useSidebarSelection} from "./selection-context";

/** Upstream's `RB` disabled reasons for a section header menu's bulk items. */
export const BULK_REASONS = {
	selectAll: "Select all needs at least two visible sessions in this group.",
	collapseAll: "Everything shown is already collapsed.",
	expandAll: "Everything is already expanded.",
	archiveAllEmpty: "Nothing to archive right now.",
	archiveAllNone:
		"Every item here is pinned, open in a pane or window, already archived, or can’t be archived from here.",
} as const;

interface HeaderRow extends SessionGroupRow {
	archived: boolean;
}

export interface GroupBulkActions {
	canSelectAll: boolean;
	selectAll: () => void;
	allCollapsed: boolean;
	noneCollapsed: boolean;
	collapseAll: () => void;
	expandAll: () => void;
	/** The section's unarchived sessions Archive all would archive: not pinned and not open. */
	archivableIds: readonly string[];
	archiveAllReason: string;
	archiveAll: () => void;
}

/**
 * The Select all, Collapse all / Expand all and Archive all (N) items that upstream's `rv` header
 * menus share, so the status, date, pinned and folder headers can't drift apart.
 */
export function useGroupBulkActions(
	group: SessionGroup<HeaderRow>,
	sectionKeys: readonly string[],
	activeItemId: string | null,
	pinned: boolean,
): GroupBulkActions {
	const selection = useSidebarSelection();
	const {collapsedFamilies, collapsedGroups} = useSidebarState();
	const archiveSessions = useArchiveSessions();
	const hiddenFamilies = new Set(collapsedFamilies);
	const visibleIds = group.rows.flatMap((row) => [
		row.sessionId,
		...(hiddenFamilies.has(familyKey(row.sessionId))
			? []
			: (group.nested.get(row.sessionId) ?? []).map((child) => child.sessionId)),
	]);
	const unarchived = group.rows
		.flatMap((row) => [row, ...(group.nested.get(row.sessionId) ?? [])])
		.filter((row) => !row.archived);
	const archivableIds = pinned
		? []
		: unarchived.filter((row) => row.sessionId !== activeItemId).map((row) => row.sessionId);
	const collapsed = new Set(collapsedGroups);
	return {
		canSelectAll: selection !== null && visibleIds.length >= 2,
		selectAll: () => {
			selection?.selectAll(visibleIds);
		},
		allCollapsed: sectionKeys.every((key) => collapsed.has(key)),
		noneCollapsed: !sectionKeys.some((key) => collapsed.has(key)),
		collapseAll: () => {
			setSidebarGroupsCollapsed(sectionKeys, true);
		},
		expandAll: () => {
			setSidebarGroupsCollapsed(sectionKeys, false);
		},
		archivableIds,
		archiveAllReason: unarchived.length === 0 ? BULK_REASONS.archiveAllEmpty : BULK_REASONS.archiveAllNone,
		archiveAll: () => {
			archiveSessions(archivableIds);
		},
	};
}
