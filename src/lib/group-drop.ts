import type { SidebarDropTarget } from "../hooks/use-sidebar-drag";

/**
 * Pure drop resolution for dragging sessions onto claude.ai/code-style custom groups
 * (Group by ▸ Custom groups): a row dropped on a group's header or at one of its row
 * slots joins that group at that position, a grouped row dropped on the "Ungroup" row
 * or the Ungrouped section leaves its group, and a dragged group header reorders
 * the sections.
 */

/** The drop row shown while a grouped row is dragged. */
export const UNGROUP_ZONE = "ungroup";
/** The Ungrouped section as a whole. */
export const UNGROUPED_SECTION_ZONE = "custom-ungrouped";

const LIST_PREFIX = "custom-group:";
const HEADER_PREFIX = "custom-group-header:";
const SECTION_PREFIX = "custom-section:";

/** Drag list id for a custom group's rows. */
export function groupListId(groupId: string): string {
  return `${LIST_PREFIX}${groupId}`;
}

/** Drag zone id for a custom group's header. */
export function groupHeaderZoneId(groupId: string): string {
  return `${HEADER_PREFIX}${groupId}`;
}

/** Drag source id for a custom group's header, distinct from session ids. */
export function sectionDragId(groupId: string): string {
  return `${SECTION_PREFIX}${groupId}`;
}

/** The group behind a section drag id, or null for a session row. */
export function sectionOfDragId(id: string): string | null {
  return id.startsWith(SECTION_PREFIX) ? id.slice(SECTION_PREFIX.length) : null;
}

function stripPrefix(id: string, prefix: string): string | null {
  return id.startsWith(prefix) ? id.slice(prefix.length) : null;
}

/** A displayed row of a group; nested rows are forks shown under their family head. */
export interface GroupListRow {
  readonly id: string;
  readonly nested: boolean;
}

export interface GroupDropGeometry {
  readonly srcId: string;
  /** The dragged session's current group, or null when ungrouped. */
  readonly srcGroupId: string | null;
  readonly target: SidebarDropTarget | null;
  /** groupId → its displayed rows in DOM order (the order the drag slots count). */
  readonly lists: Readonly<Record<string, readonly GroupListRow[]>>;
}

export type GroupDropOutcome =
  | {
      readonly type: "group";
      readonly groupId: string;
      /** Place the session just before this one, or at the end when null. */
      readonly before: string | null;
    }
  | { readonly type: "ungroup" }
  | null;

function heads(rows: readonly GroupListRow[]): string[] {
  return rows.filter((row) => !row.nested).map((row) => row.id);
}

/** The first family head at or after `slot`, skipping the dragged row. */
function headFrom(rows: readonly GroupListRow[], slot: number, srcId: string): string | null {
  return rows.slice(slot).find((row) => !row.nested && row.id !== srcId)?.id ?? null;
}

function sameOrder(first: readonly string[], second: readonly string[]): boolean {
  return first.length === second.length && first.every((id, index) => id === second[index]);
}

function place(
  { srcId, srcGroupId, lists }: GroupDropGeometry,
  groupId: string,
  before: string | null,
): GroupDropOutcome {
  if (srcGroupId === groupId) {
    const current = heads(lists[groupId] ?? []);
    const rest = current.filter((id) => id !== srcId);
    const index = before === null ? rest.length : rest.indexOf(before);
    const next = [...rest.slice(0, index), srcId, ...rest.slice(index)];
    if (sameOrder(current, next)) return null;
  }
  return { type: "group", groupId, before };
}

/** What releasing a session row drag does to the custom groups, or null for nothing. */
export function groupDropOutcome(geometry: GroupDropGeometry): GroupDropOutcome {
  const { srcId, srcGroupId, target, lists } = geometry;
  if (target === null) return null;
  if (target.type === "zone") {
    if (target.zoneId === UNGROUP_ZONE || target.zoneId === UNGROUPED_SECTION_ZONE) {
      return srcGroupId === null ? null : { type: "ungroup" };
    }
    const groupId = stripPrefix(target.zoneId, HEADER_PREFIX);
    if (groupId === null) return null;
    return place(geometry, groupId, headFrom(lists[groupId] ?? [], 0, srcId));
  }
  const groupId = stripPrefix(target.listId, LIST_PREFIX);
  if (groupId === null) return null;
  return place(geometry, groupId, headFrom(lists[groupId] ?? [], target.slot, srcId));
}

export interface SectionDropGeometry {
  /** The dragged section's group. */
  readonly groupId: string;
  readonly target: SidebarDropTarget | null;
  /** Every group id in section order. */
  readonly groupIds: readonly string[];
}

/**
 * Where a dragged custom group header lands: at the index of the header it is
 * dropped on, or last when dropped on Ungrouped. Null when nothing moves.
 */
export function sectionDropOutcome({
  groupId,
  target,
  groupIds,
}: SectionDropGeometry): { readonly groupId: string; readonly toIndex: number } | null {
  if (target?.type !== "zone") return null;
  const from = groupIds.indexOf(groupId);
  let toIndex = -1;
  if (target.zoneId === UNGROUPED_SECTION_ZONE) {
    toIndex = groupIds.length - 1;
  } else {
    const onto = stripPrefix(target.zoneId, HEADER_PREFIX);
    toIndex = onto === null ? -1 : groupIds.indexOf(onto);
  }
  if (from === -1 || toIndex === -1 || toIndex === from) return null;
  return { groupId, toIndex };
}
