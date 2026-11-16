import type {SidebarDropTarget} from "../hooks/use-sidebar-drag";
import {displayedNested, type FamilyFoldState, type FoldableRow} from "./family-fold";
import {customGroupIdOfKey, type ManualSectionGroups, type SessionGroupRow} from "./session-groups";

/**
 * Pure drop resolution for dragging sessions onto claude.ai/code-style custom groups
 * (Group by ▸ Custom groups): a row dropped on a group's header or at one of its row
 * slots joins that group at that position, a grouped row dropped on the "Remove from …" row
 * or on Recents leaves its group, and a dragged group header reorders
 * the sections.
 */

/** The drop row shown while a grouped row is dragged. */
export const UNGROUP_ZONE = "ungroup";
/** Recents as a whole: a section row dropped there leaves its section, and a pinned one is unpinned. */
export const UNGROUPED_SECTION_ZONE = "custom-ungrouped";

const LIST_PREFIX = "custom-group:";
const HEADER_PREFIX = "custom-group-header:";

/** Drag list id for a custom group's rows. */
export function groupListId(groupId: string): string
{
	return `${LIST_PREFIX}${groupId}`;
}

/** Drag zone id for a custom group's header. */
export function groupHeaderZoneId(groupId: string): string
{
	return `${HEADER_PREFIX}${groupId}`;
}

function stripPrefix(id: string, prefix: string): string | null
{
	return id.startsWith(prefix) ? id.slice(prefix.length) : null;
}

/** A displayed row of a group; nested rows are forks shown under their family head. */
export interface GroupListRow
{
	readonly id: string;
	readonly nested: boolean;
}

export interface GroupDropGeometry
{
	readonly srcId: string;
	/** The dragged session's current group, or null when ungrouped. */
	readonly srcGroupId: string | null;
	readonly target: SidebarDropTarget | null;
	/** groupId → its displayed rows in DOM order (the order the drag slots count). */
	readonly lists: Readonly<Record<string, readonly GroupListRow[]>>;
}

export type GroupDropOutcome =
	|
	  {
			readonly type: "group";
			readonly groupId: string;
			/** Place the session just before this one, or at the end when null. */
			readonly before: string | null;
	  }
	|
	  {
			readonly type: "ungroup";
	  }
	| null;

function heads(rows: readonly GroupListRow[]): string[]
{
	return rows.filter((row) => !row.nested).map((row) => row.id);
}

/** The first family head at or after `slot`, skipping the dragged row. */
function headFrom(rows: readonly GroupListRow[], slot: number, srcId: string): string | null
{
	return rows.slice(slot).find((row) => !row.nested && row.id !== srcId)?.id ?? null;
}

function sameOrder(first: readonly string[], second: readonly string[]): boolean
{
	return first.length === second.length && first.every((id, index) => id === second[index]);
}

function place({srcId, srcGroupId, lists}: GroupDropGeometry, groupId: string, before: string | null): GroupDropOutcome
{
	if (srcGroupId === groupId)
	{
		const current = heads(lists[groupId] ?? []);
		const rest = current.filter((id) => id !== srcId);
		const index = before === null ? rest.length : rest.indexOf(before);
		const next = [...rest.slice(0, index), srcId, ...rest.slice(index)];
		if (sameOrder(current, next)) return null;
	}
	return {
		type: "group",
		groupId,
		before,
	};
}

/** What releasing a session row drag does to the custom groups, or null for nothing. */
export function groupDropOutcome(geometry: GroupDropGeometry): GroupDropOutcome
{
	const {srcId, srcGroupId, target, lists} = geometry;
	if (target === null) return null;
	if (target.type === "zone")
	{
		if (target.zoneId === UNGROUP_ZONE || target.zoneId === UNGROUPED_SECTION_ZONE)
		{
			return srcGroupId === null
				? null
				:
					{
						type: "ungroup",
					};
		}
		const groupId = stripPrefix(target.zoneId, HEADER_PREFIX);
		if (groupId === null) return null;
		return place(geometry, groupId, headFrom(lists[groupId] ?? [], 0, srcId));
	}
	const groupId = stripPrefix(target.listId, LIST_PREFIX);
	if (groupId === null) return null;
	return place(geometry, groupId, headFrom(lists[groupId] ?? [], target.slot, srcId));
}

export interface MultiGroupDropGeometry
{
	/** The selected sessions being dragged, in display order. */
	readonly srcIds: readonly string[];
	/** Each dragged session's current group, or null when ungrouped. */
	readonly srcGroupIds: readonly (string | null)[];
	readonly target: SidebarDropTarget | null;
	readonly lists: GroupDropGeometry["lists"];
}

/**
 * What releasing a multi-row drag does: like upstream, a selection can only drop
 * on a custom group (header or row slot), on Remove from … or on Recents; it can never pin.
 */
export function multiGroupDropOutcome({srcIds, srcGroupIds, target, lists}: MultiGroupDropGeometry): GroupDropOutcome
{
	if (target === null) return null;
	const selected = new Set(srcIds);
	const firstHead = (groupId: string, slot: number) =>
		(lists[groupId] ?? []).slice(slot).find((row) => !row.nested && !selected.has(row.id))?.id ?? null;
	if (target.type === "zone")
	{
		if (target.zoneId === UNGROUP_ZONE || target.zoneId === UNGROUPED_SECTION_ZONE)
		{
			return srcGroupIds.some((id) => id !== null)
				?
					{
						type: "ungroup",
					}
				: null;
		}
		const groupId = stripPrefix(target.zoneId, HEADER_PREFIX);
		return groupId === null
			? null
			:
				{
					type: "group",
					groupId,
					before: firstHead(groupId, 0),
				};
	}
	const groupId = stripPrefix(target.listId, LIST_PREFIX);
	return groupId === null
		? null
		:
			{
				type: "group",
				groupId,
				before: firstHead(groupId, target.slot),
			};
}

/** Each manual section's displayed rows in DOM order: heads, then their families' listed nested rows. */
export function groupLists<Row extends SessionGroupRow & FoldableRow>(
	manual: readonly ManualSectionGroups<Row>[],
	familyFold: FamilyFoldState,
): Record<string, readonly GroupListRow[]>
{
	const lists: Record<string, readonly GroupListRow[]> = {};
	for (const {group} of manual)
	{
		const groupId = customGroupIdOfKey(group.key);
		if (groupId === null) continue;
		lists[groupId] = group.rows.flatMap((row) => [
			{
				id: row.sessionId,
				nested: false,
			},
			...displayedNested(row.sessionId, group.nested.get(row.sessionId) ?? [], familyFold).map((child) => (
			{
				id: child.sessionId,
				nested: true,
			})),
		]);
	}
	return lists;
}
