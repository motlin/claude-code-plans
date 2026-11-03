import {Ellipsis} from "lucide-react";
import {type ReactNode, useState} from "react";

import {setProjectAppearance, useProjectAppearance} from "../../lib/project-appearance-store";
import {createGroup} from "../../lib/session-group-store";
import type {SessionGroup, SessionGroupRow} from "../../lib/session-groups";
import {NewGroupDialog} from "../new-group-dialog";
import {ContextMenu, ContextMenuTrigger, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger} from "../ui/menu";
import {KEBAB_CLASS} from "./custom-group-header";
import {GroupAppearanceSubmenu} from "./group-appearance";
import {useGroupBulkActions} from "./group-bulk-items";
import {ArchiveAllConfirm, GroupBulkMenuItems} from "./group-header-context-menu";
import {useAfterMenuClose} from "./use-after-menu-close";

/** Upstream `zl` `place-unknown`: why "Other" or a project whose folder is gone can't start a session. */
const PLACE_UNKNOWN = "Where these sessions run isn’t known, so there’s nowhere to start a new one.";

/** Upstream's worked-out section reasons (no environments locally, so Rename and Delete show disabled). */
const WORKED_OUT = {
	rename: "This group is made automatically, so it can’t be renamed.",
	delete: "This group is made automatically, so it can’t be deleted.",
	/** `fixedAtEnd`: folder sections have no reorder context locally. */
	move: "This group stays at the end of the list.",
} as const;

interface HeaderRow extends SessionGroupRow {
	archived: boolean;
}

/**
 * The label of a Folder (project) section with upstream's worked-out `rv` header menu, opened by
 * right-click or the hover kebab: New session (disabled with the place-unknown reason when the
 * section has no folder) | New group…, Rename, Move up, Move down | Select all | Collapse all,
 * Expand all | Icon and color ▸ | Archive all (N) | Delete. The section is made automatically, so
 * Rename, Move and Delete are disabled with upstream's reasons.
 */
export function ProjectGroupHeader({
	group,
	sectionKeys,
	activeItemId,
	onNewSession,
	children,
}: {
	group: SessionGroup<HeaderRow>;
	/** Every section shown in the list, for Collapse all and Expand all. */
	sectionKeys: readonly string[];
	/** The open session, which Archive all leaves alone. */
	activeItemId: string | null;
	/** Starts a session in this project's folder, or null when it has none. */
	onNewSession: (() => void) | null;
	/** The label's toggle button. */
	children: ReactNode;
}) {
	const appearance = useProjectAppearance()[group.key];
	const actions = useGroupBulkActions(group, sectionKeys, activeItemId, false);
	const [dialog, setDialog] = useState<"new-group" | "archive-all" | null>(null);
	// The composer and dialogs take focus, so they act only once the menu has closed.
	const {later, menuProps, contentProps} = useAfterMenuClose();
	const items = (
		<>
			<MenuItem
				disabled={onNewSession === null}
				disabledReason={PLACE_UNKNOWN}
				onSelect={later(() => onNewSession?.())}
			>
				New session
			</MenuItem>
			<MenuSeparator />
			<MenuItem
				onSelect={later(() => {
					setDialog("new-group");
				})}
			>
				New group…
			</MenuItem>
			<MenuItem disabled disabledReason={WORKED_OUT.rename}>
				Rename
			</MenuItem>
			<MenuItem disabled disabledReason={WORKED_OUT.move}>
				Move up
			</MenuItem>
			<MenuItem disabled disabledReason={WORKED_OUT.move}>
				Move down
			</MenuItem>
			<GroupBulkMenuItems
				actions={actions}
				onArchiveAll={later(() => {
					setDialog("archive-all");
				})}
				beforeArchive={
					<GroupAppearanceSubmenu
						appearance={appearance}
						onChange={(patch) => {
							setProjectAppearance(group.key, patch);
						}}
					/>
				}
			/>
			<MenuSeparator />
			<MenuItem variant="danger" disabled disabledReason={WORKED_OUT.delete}>
				Delete
			</MenuItem>
		</>
	);
	return (
		<>
			<div className="flex min-w-0 flex-1 items-center">
				<ContextMenu {...menuProps}>
					<ContextMenuTrigger className="flex min-w-0 flex-1">{children}</ContextMenuTrigger>
					<MenuContent {...contentProps}>{items}</MenuContent>
				</ContextMenu>
			</div>
			<Menu {...menuProps}>
				<MenuTrigger aria-label={`More options for ${group.label}`} data-row-action="" className={KEBAB_CLASS}>
					<Ellipsis aria-hidden="true" className="size-4" />
				</MenuTrigger>
				<MenuContent align="end" {...contentProps}>
					{items}
				</MenuContent>
			</Menu>
			<NewGroupDialog
				open={dialog === "new-group"}
				onOpenChange={(open) => {
					setDialog(open ? "new-group" : null);
				}}
				onCreate={(name) => {
					createGroup(name);
				}}
			/>
			<ArchiveAllConfirm
				open={dialog === "archive-all"}
				onOpenChange={(open) => {
					setDialog(open ? "archive-all" : null);
				}}
				label={group.label}
				onConfirm={actions.archiveAll}
			/>
		</>
	);
}
