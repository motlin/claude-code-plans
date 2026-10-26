import {useNavigate} from "@tanstack/react-router";
import {type ReactNode, useRef, useState} from "react";

import {useArchiveSessions} from "../../hooks/use-session-archive";
import {requestHomeComposerFocus} from "../../lib/home-composer-focus";
import {familyKey, setSidebarGroupsCollapsed, useSidebarState} from "../../lib/sidebar-store";
import type {SessionGroup, SessionGroupRow} from "../../lib/session-groups";
import {ConfirmDialog} from "../confirm-dialog";
import {ContextMenu, ContextMenuTrigger, MenuContent, MenuItem, MenuSeparator} from "../ui/menu";
import {useSidebarSelection} from "./selection-context";

/** Upstream's `RB` disabled reasons for the header context menu. */
const REASONS = {
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

/**
 * The label of a State, Date, ungrouped or Pinned section, with upstream's header context menu
 * (`group-header-context-menu`): New session | Select all | Collapse all, Expand all | Archive all (N),
 * each disabled with upstream's reason when it would do nothing.
 */
export function GroupHeaderContextMenu({
	group,
	sectionKeys,
	activeItemId,
	pinned,
	children,
}: {
	group: SessionGroup<HeaderRow>;
	/** Every section shown in the list, for Collapse all and Expand all. */
	sectionKeys: readonly string[];
	/** The open session, which Archive all leaves alone. */
	activeItemId: string | null;
	/** The section holds pinned rows, which Archive all leaves alone. */
	pinned: boolean;
	/** The label's toggle button. */
	children: ReactNode;
}): ReactNode {
	const navigate = useNavigate();
	const selection = useSidebarSelection();
	const {collapsedFamilies, collapsedGroups} = useSidebarState();
	const archiveSessions = useArchiveSessions();
	const [confirmArchive, setConfirmArchive] = useState(false);
	// The composer and the confirm take focus, so they act only once the menu has closed.
	const afterClose = useRef<(() => void) | null>(null);
	// Menus hand focus back after onOpenChangeComplete, so this outlives the queued action.
	const keepFocus = useRef(false);

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
	const allCollapsed = sectionKeys.every((key) => collapsed.has(key));
	const noneCollapsed = !sectionKeys.some((key) => collapsed.has(key));
	const canSelectAll = selection !== null && visibleIds.length >= 2;

	const later = (action: () => void) => () => {
		afterClose.current = action;
		keepFocus.current = true;
	};
	const onOpenChangeComplete = (open: boolean) => {
		if (open) {
			keepFocus.current = false;
			return;
		}
		const action = afterClose.current;
		afterClose.current = null;
		action?.();
	};

	return (
		<>
			<ContextMenu onOpenChangeComplete={onOpenChangeComplete}>
				<ContextMenuTrigger className="flex min-w-0 flex-1">{children}</ContextMenuTrigger>
				<MenuContent finalFocus={() => !keepFocus.current}>
					<MenuItem onSelect={later(() => void navigate({to: "/"}).then(requestHomeComposerFocus))}>
						New session
					</MenuItem>
					<MenuSeparator />
					<MenuItem
						disabled={!canSelectAll}
						disabledReason={REASONS.selectAll}
						onSelect={() => {
							selection?.selectAll(visibleIds);
						}}
					>
						Select all
					</MenuItem>
					<MenuSeparator />
					<MenuItem
						disabled={allCollapsed}
						disabledReason={REASONS.collapseAll}
						onSelect={() => {
							setSidebarGroupsCollapsed(sectionKeys, true);
						}}
					>
						Collapse all
					</MenuItem>
					<MenuItem
						disabled={noneCollapsed}
						disabledReason={REASONS.expandAll}
						onSelect={() => {
							setSidebarGroupsCollapsed(sectionKeys, false);
						}}
					>
						Expand all
					</MenuItem>
					<MenuSeparator />
					<MenuItem
						disabled={archivableIds.length === 0}
						disabledReason={unarchived.length === 0 ? REASONS.archiveAllEmpty : REASONS.archiveAllNone}
						onSelect={later(() => {
							setConfirmArchive(true);
						})}
					>
						Archive all ({archivableIds.length})
					</MenuItem>
				</MenuContent>
			</ContextMenu>
			<ConfirmDialog
				open={confirmArchive}
				onOpenChange={setConfirmArchive}
				title={`Archive all sessions in “${group.label}”?`}
				confirmLabel="Archive"
				onConfirm={() => {
					archiveSessions(archivableIds);
				}}
			/>
		</>
	);
}
