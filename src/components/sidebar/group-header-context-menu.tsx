import {useNavigate} from "@tanstack/react-router";
import {type ReactNode, useState} from "react";

import {requestHomeComposerFocus} from "../../lib/home-composer-focus";
import type {SessionGroup, SessionGroupRow} from "../../lib/session-groups";
import {ConfirmDialog} from "../confirm-dialog";
import {ContextMenu, ContextMenuTrigger, MenuContent, MenuItem, MenuSeparator} from "../ui/menu";
import {BULK_REASONS, type GroupBulkActions, useGroupBulkActions} from "./group-bulk-items";
import {useAfterMenuClose} from "./use-after-menu-close";

interface HeaderRow extends SessionGroupRow {
	archived: boolean;
}

/** Upstream `rv`'s organize, view and remove groups: Select all | Collapse all, Expand all | Archive all (N). */
export function GroupBulkMenuItems({
	actions,
	onArchiveAll,
	beforeArchive,
}: {
	actions: GroupBulkActions;
	/** Opens the Archive all confirm (after the menu closes). */
	onArchiveAll: () => void;
	/** Items with no upstream group, shown between the view and remove groups (the Icon and color picker). */
	beforeArchive?: ReactNode;
}) {
	return (
		<>
			<MenuSeparator />
			<MenuItem
				disabled={!actions.canSelectAll}
				disabledReason={BULK_REASONS.selectAll}
				onSelect={actions.selectAll}
			>
				Select all
			</MenuItem>
			<MenuSeparator />
			<MenuItem
				disabled={actions.allCollapsed}
				disabledReason={BULK_REASONS.collapseAll}
				onSelect={actions.collapseAll}
			>
				Collapse all
			</MenuItem>
			<MenuItem
				disabled={actions.noneCollapsed}
				disabledReason={BULK_REASONS.expandAll}
				onSelect={actions.expandAll}
			>
				Expand all
			</MenuItem>
			{beforeArchive !== undefined && (
				<>
					<MenuSeparator />
					{beforeArchive}
				</>
			)}
			<MenuSeparator />
			<MenuItem
				disabled={actions.archivableIds.length === 0}
				disabledReason={actions.archiveAllReason}
				onSelect={onArchiveAll}
			>
				Archive all ({actions.archivableIds.length})
			</MenuItem>
		</>
	);
}

/** Upstream's Archive all confirm for a section. */
export function ArchiveAllConfirm({
	open,
	onOpenChange,
	label,
	onConfirm,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	label: string;
	onConfirm: () => void;
}) {
	return (
		<ConfirmDialog
			open={open}
			onOpenChange={onOpenChange}
			title={`Archive all sessions in “${label}”?`}
			confirmLabel="Archive"
			onConfirm={onConfirm}
		/>
	);
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
	const actions = useGroupBulkActions(group, sectionKeys, activeItemId, pinned);
	const [confirmArchive, setConfirmArchive] = useState(false);
	// The composer and the confirm take focus, so they act only once the menu has closed.
	const {later, menuProps, contentProps} = useAfterMenuClose();

	return (
		<>
			<ContextMenu {...menuProps}>
				<ContextMenuTrigger className="flex min-w-0 flex-1">{children}</ContextMenuTrigger>
				<MenuContent {...contentProps}>
					<MenuItem onSelect={later(() => void navigate({to: "/"}).then(requestHomeComposerFocus))}>
						New session
					</MenuItem>
					<GroupBulkMenuItems
						actions={actions}
						onArchiveAll={later(() => {
							setConfirmArchive(true);
						})}
					/>
				</MenuContent>
			</ContextMenu>
			<ArchiveAllConfirm
				open={confirmArchive}
				onOpenChange={setConfirmArchive}
				label={group.label}
				onConfirm={actions.archiveAll}
			/>
		</>
	);
}
