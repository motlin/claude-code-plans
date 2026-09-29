import { Ellipsis } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";

import { useArchiveSessions } from "../../hooks/use-session-archive";
import {
  createGroup,
  deleteGroup,
  moveGroup,
  renameGroup,
  sortGroupsByName,
  useSessionGroups,
} from "../../lib/session-group-store";
import { readSidebarState, toggleSidebarGroup } from "../../lib/sidebar-store";
import { ConfirmDialog } from "../confirm-dialog";
import { InlineRenameInput } from "../inline-rename-input";
import { NewGroupDialog } from "../new-group-dialog";
import {
  ContextMenu,
  ContextMenuTrigger,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";

const KEBAB_CLASS =
  "flex size-6 shrink-0 items-center justify-center rounded-r6 text-ink-muted opacity-0 transition-opacity hover:bg-fill-ghost-hover hover:text-primary focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-100 group-hover/labelrow:opacity-100 data-[popup-open]:opacity-100 data-[popup-open]:bg-fill-ghost-hover pointer-coarse:opacity-100";

type Dialog = "new-group" | "delete" | "archive-all";

/** Upstream's delete confirm body, pluralized on the sessions assigned to the group. */
function deleteGroupBody(name: string, count: number): string {
  const rest =
    count === 0
      ? "Nothing is in it."
      : `The ${count} ${count === 1 ? "item" : "items"} in it will no longer be grouped.`;
  return `“${name}” will be removed. ${rest}`;
}

/**
 * The label of a Custom groups section with claude.ai/code's header menu,
 * opened by right-clicking the label or by its hover kebab: Rename group
 * (inline), New group…, Move up / Move down / Sort A to Z, Archive all (N)
 * and Delete group behind a confirm.
 */
export function CustomGroupHeader({
  groupId,
  groupKey,
  label,
  archivableIds,
  children,
}: {
  groupId: string;
  /** The section key, whose collapsed state goes with the group on delete. */
  groupKey: string;
  label: string;
  /** Unarchived sessions shown in the section, for Archive all. */
  archivableIds: readonly string[];
  /** The label's toggle button, replaced by the rename input while renaming. */
  children: ReactNode;
}) {
  const { groups, assignments } = useSessionGroups();
  const [renaming, setRenaming] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const archiveSessions = useArchiveSessions();
  const labelRef = useRef<HTMLDivElement>(null);
  // Dialogs and the rename input take focus, so they open only once the menu has closed.
  const afterClose = useRef<(() => void) | null>(null);
  // Menus hand focus back after onOpenChangeComplete, so this outlives the queued action.
  const keepFocus = useRef(false);

  const index = groups.findIndex((group) => group.id === groupId);
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
      count={groups.length}
      archiveCount={archivableIds.length}
      onRename={later(() => setRenaming(true))}
      onNewGroup={later(() => setDialog("new-group"))}
      onMove={(delta) => moveGroup(groupId, index + delta)}
      onSort={sortGroupsByName}
      onArchiveAll={later(() => setDialog("archive-all"))}
      onDelete={later(() => setDialog("delete"))}
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
                ariaLabel="Rename group"
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
        <MenuTrigger
          aria-label={`More options for ${label}`}
          data-row-action=""
          className={KEBAB_CLASS}
        >
          <Ellipsis aria-hidden="true" className="size-4" />
        </MenuTrigger>
        <MenuContent align="end" finalFocus={finalFocus}>
          {items}
        </MenuContent>
      </Menu>
      <NewGroupDialog
        open={dialog === "new-group"}
        onOpenChange={(open) => setDialog(open ? "new-group" : null)}
        switchesGroupBy={false}
        onCreate={(name) => createGroup(name)}
      />
      <ConfirmDialog
        open={dialog === "delete"}
        onOpenChange={(open) => setDialog(open ? "delete" : null)}
        title="Delete group?"
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
        onOpenChange={(open) => setDialog(open ? "archive-all" : null)}
        title={`Archive all sessions in “${label}”?`}
        confirmLabel="Archive"
        onConfirm={() => archiveSessions(archivableIds)}
      />
    </>
  );
}

function CustomGroupMenuItems({
  index,
  count,
  archiveCount,
  onRename,
  onNewGroup,
  onMove,
  onSort,
  onArchiveAll,
  onDelete,
}: {
  /** The group's position among all sections, -1 when unknown. */
  index: number;
  count: number;
  archiveCount: number;
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
      <MenuItem onSelect={onRename}>Rename group</MenuItem>
      <MenuItem onSelect={onNewGroup}>New group…</MenuItem>
      {canReorder && (
        <>
          <MenuSeparator />
          {index > 0 && <MenuItem onSelect={() => onMove(-1)}>Move up</MenuItem>}
          {index < count - 1 && <MenuItem onSelect={() => onMove(1)}>Move down</MenuItem>}
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
        Delete group
      </MenuItem>
    </>
  );
}
