import {Ellipsis} from "lucide-react";
import {type ReactNode, useRef, useState} from "react";

import {useArchiveSessions} from "../../hooks/use-session-archive";
import {
	createGroup,
	deleteGroup,
	renameGroup,
	setGroupAppearance,
	useSessionGroups,
} from "../../lib/session-group-store";
import {moveSidebarSection, sortManualSectionsByName, useSidebarSections} from "../../lib/sidebar-sections";
import {readSidebarState, toggleSidebarGroup} from "../../lib/sidebar-store";
import type {GroupAppearance, GroupAppearancePatch} from "../../lib/group-appearance";
import {ConfirmDialog} from "../confirm-dialog";
import {InlineRenameInput} from "../inline-rename-input";
import {NewGroupDialog} from "../new-group-dialog";
import {GroupAppearanceSubmenu} from "./group-appearance";
import {ContextMenu, ContextMenuTrigger, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger} from "../ui/menu";

export const KEBAB_CLASS =
	"df-touch-reveal flex size-6 shrink-0 items-center justify-center rounded-r6 text-ink-muted opacity-0 transition-opacity hover:bg-fill-ghost-hover hover:text-primary focus-visible:opacity-100 hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus group-hover/labelrow:opacity-100 data-[popup-open]:opacity-100 data-[popup-open]:bg-fill-ghost-hover pointer-coarse:opacity-100";

type Dialog = "new-group" | "delete" | "archive-all";

/** Upstream `Cg.deleteBody`, pluralized on the sessions in the section. */
function deleteGroupBody(name: string, count: number): string {
	const rest =
		count === 0
			? "Nothing is in it."
			: count === 1
				? "The 1 session in it moves back to your other sessions."
				: `The ${count} sessions in it move back to your other sessions.`;
	return `“${name}” will be removed. ${rest}`;
}

/**
 * The header label of a manual section with claude.ai/code's header menu, opened by right-clicking
 * the label or by its hover kebab: New session (upstream `rv`), Rename section (inline), Icon and
 * color ▸, New section, Move up / Move down / Sort A to Z among the manual sections, Archive all (N)
 * and Delete section behind a confirm.
 */
export function CustomGroupHeader({
	groupId,
	groupKey,
	label,
	archivableIds,
	onNewSession,
	children,
}: {
	groupId: string;
	/** The section key, whose collapsed state goes with the group on delete. */
	groupKey: string;
	label: string;
	/** Unarchived sessions shown in the section, for Archive all. */
	archivableIds: readonly string[];
	/** Starts a session that joins this group, as the header's + does. */
	onNewSession: () => void;
	/** The label's toggle button, replaced by the rename input while renaming. */
	children: ReactNode;
}) {
	const {groups, assignments} = useSessionGroups();
	const sections = useSidebarSections();
	const manual = sections.filter((section) => section.kind === "manual");
	const [renaming, setRenaming] = useState(false);
	const [dialog, setDialog] = useState<Dialog | null>(null);
	const archiveSessions = useArchiveSessions();
	const labelRef = useRef<HTMLDivElement>(null);
	// Dialogs and the rename input take focus, so they open only once the menu has closed.
	const afterClose = useRef<(() => void) | null>(null);
	// Menus hand focus back after onOpenChangeComplete, so this outlives the queued action.
	const keepFocus = useRef(false);

	const index = manual.findIndex((section) => section.id === groupId);
	const appearance = groups.find((group) => group.id === groupId);
	const assignedCount = Object.values(assignments).filter((id) => id === groupId).length;

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
	const finalFocus = () => !keepFocus.current;

	const endRename = () => {
		setRenaming(false);
		requestAnimationFrame(() => {
			labelRef.current?.querySelector<HTMLElement>("[data-group-toggle]")?.focus();
		});
	};

	const items = (
		<CustomGroupMenuItems
			index={index}
			count={manual.length}
			archiveCount={archivableIds.length}
			appearance={appearance}
			onAppearance={(patch) => {
				setGroupAppearance(groupId, patch);
			}}
			onNewSession={later(onNewSession)}
			onRename={later(() => {
				setRenaming(true);
			})}
			onNewGroup={later(() => {
				setDialog("new-group");
			})}
			onMove={(delta) => {
				const neighbour = manual[index + delta];
				if (neighbour !== undefined) moveSidebarSection(groupId, sections.indexOf(neighbour));
			}}
			onSort={sortManualSectionsByName}
			onArchiveAll={later(() => {
				setDialog("archive-all");
			})}
			onDelete={later(() => {
				setDialog("delete");
			})}
		/>
	);

	return (
		<>
			<div ref={labelRef} className="flex min-w-0 flex-1 items-center">
				<ContextMenu onOpenChangeComplete={onOpenChangeComplete} disabled={renaming}>
					<ContextMenuTrigger className="flex min-w-0 flex-1">
						{renaming ? (
							<InlineRenameInput
								value={label}
								ariaLabel="Rename section"
								onCommit={(name) => {
									renameGroup(groupId, name);
									endRename();
								}}
								onCancel={endRename}
							/>
						) : (
							children
						)}
					</ContextMenuTrigger>
					<MenuContent finalFocus={finalFocus}>{items}</MenuContent>
				</ContextMenu>
			</div>
			<Menu onOpenChangeComplete={onOpenChangeComplete}>
				<MenuTrigger aria-label={`More options for ${label}`} data-row-action="" className={KEBAB_CLASS}>
					<Ellipsis aria-hidden="true" className="size-4" />
				</MenuTrigger>
				<MenuContent align="end" finalFocus={finalFocus}>
					{items}
				</MenuContent>
			</Menu>
			<NewGroupDialog
				open={dialog === "new-group"}
				onOpenChange={(open) => {
					setDialog(open ? "new-group" : null);
				}}
				onCreate={(name) => createGroup(name)}
			/>
			<ConfirmDialog
				open={dialog === "delete"}
				onOpenChange={(open) => {
					setDialog(open ? "delete" : null);
				}}
				title="Delete section?"
				body={deleteGroupBody(label, assignedCount)}
				confirmLabel="Delete"
				variant="danger"
				onConfirm={() => {
					deleteGroup(groupId);
					if (readSidebarState().collapsedGroups.includes(groupKey)) toggleSidebarGroup(groupKey);
				}}
			/>
			<ConfirmDialog
				open={dialog === "archive-all"}
				onOpenChange={(open) => {
					setDialog(open ? "archive-all" : null);
				}}
				title={`Archive all sessions in “${label}”?`}
				confirmLabel="Archive"
				onConfirm={() => {
					archiveSessions(archivableIds);
				}}
			/>
		</>
	);
}

function CustomGroupMenuItems({
	index,
	count,
	archiveCount,
	appearance,
	onAppearance,
	onNewSession,
	onRename,
	onNewGroup,
	onMove,
	onSort,
	onArchiveAll,
	onDelete,
}: {
	/** The section's position among the manual sections, -1 when unknown. */
	index: number;
	count: number;
	archiveCount: number;
	appearance: GroupAppearance | undefined;
	onAppearance: (patch: GroupAppearancePatch) => void;
	onNewSession: () => void;
	onRename: () => void;
	onNewGroup: () => void;
	onMove: (delta: -1 | 1) => void;
	onSort: () => void;
	onArchiveAll: () => void;
	onDelete: () => void;
}) {
	const canReorder = index !== -1 && count > 1;
	return (
		<>
			<MenuItem onSelect={onNewSession}>New session</MenuItem>
			<MenuSeparator />
			<MenuItem onSelect={onRename}>Rename section</MenuItem>
			<GroupAppearanceSubmenu appearance={appearance} onChange={onAppearance} />
			<MenuItem onSelect={onNewGroup}>New section</MenuItem>
			{canReorder && (
				<>
					<MenuSeparator />
					{index > 0 && (
						<MenuItem
							onSelect={() => {
								onMove(-1);
							}}
						>
							Move up
						</MenuItem>
					)}
					{index < count - 1 && (
						<MenuItem
							onSelect={() => {
								onMove(1);
							}}
						>
							Move down
						</MenuItem>
					)}
					<MenuItem onSelect={onSort}>Sort A to Z</MenuItem>
				</>
			)}
			{archiveCount > 0 && (
				<>
					<MenuSeparator />
					<MenuItem onSelect={onArchiveAll}>Archive all ({archiveCount})</MenuItem>
				</>
			)}
			<MenuSeparator />
			<MenuItem variant="danger" onSelect={onDelete}>
				Delete section
			</MenuItem>
		</>
	);
}
