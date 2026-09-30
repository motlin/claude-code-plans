import {describe, expect, it} from "vite-plus/test";

import type {SidebarDropTarget} from "../src/hooks/use-sidebar-drag";
import {
	groupDropOutcome,
	groupHeaderZoneId,
	groupListId,
	type GroupDropGeometry,
	multiGroupDropOutcome,
	sectionDragId,
	sectionDropOutcome,
	sectionOfDragId,
	UNGROUP_ZONE,
	UNGROUPED_SECTION_ZONE,
} from "../src/lib/group-drop";

const LISTS: GroupDropGeometry["lists"] = {
	A: [
		{id: "a1", nested: false},
		{id: "a2", nested: false},
		{id: "a2-fork", nested: true},
	],
	B: [{id: "b1", nested: false}],
};

function slot(groupId: string, index: number): SidebarDropTarget {
	return {type: "slot", listId: groupListId(groupId), slot: index};
}

function zone(zoneId: string): SidebarDropTarget {
	return {type: "zone", zoneId};
}

describe("groupDropOutcome", () => {
	it.each<[string, string, string | null, SidebarDropTarget | null, ReturnType<typeof groupDropOutcome>]>([
		[
			"an ungrouped row at a group's first slot",
			"u1",
			null,
			slot("A", 0),
			{type: "group", groupId: "A", before: "a1"},
		],
		[
			"an ungrouped row at a group's last slot",
			"u1",
			null,
			slot("A", 3),
			{type: "group", groupId: "A", before: null},
		],
		[
			"a slot inside a family goes after the family",
			"u1",
			null,
			slot("A", 2),
			{type: "group", groupId: "A", before: null},
		],
		[
			"an ungrouped row on a group header goes to its top",
			"u1",
			null,
			zone(groupHeaderZoneId("B")),
			{type: "group", groupId: "B", before: "b1"},
		],
		[
			"a row on an empty group's header",
			"u1",
			null,
			zone(groupHeaderZoneId("C")),
			{type: "group", groupId: "C", before: null},
		],
		["a grouped row onto another group", "a1", "A", slot("B", 1), {type: "group", groupId: "B", before: null}],
		[
			"a grouped row to the end of its own group",
			"a1",
			"A",
			slot("A", 3),
			{type: "group", groupId: "A", before: null},
		],
		["a grouped row up within its own group", "a2", "A", slot("A", 0), {type: "group", groupId: "A", before: "a1"}],
		["a row that stays where it is", "a2", "A", slot("A", 3), null],
		["the first row onto its own header", "a1", "A", zone(groupHeaderZoneId("A")), null],
		["a grouped row on the Ungroup row", "a1", "A", zone(UNGROUP_ZONE), {type: "ungroup"}],
		["a grouped row on the Ungrouped section", "b1", "B", zone(UNGROUPED_SECTION_ZONE), {type: "ungroup"}],
		["an ungrouped row on the Ungroup row", "u1", null, zone(UNGROUP_ZONE), null],
		["an ungrouped row on the Ungrouped section", "u1", null, zone(UNGROUPED_SECTION_ZONE), null],
		["no target", "u1", null, null, null],
		["a non-group zone", "u1", null, zone("pin-drop"), null],
		["a non-group list", "u1", null, {type: "slot", listId: "pinned", slot: 0}, null],
	])("%s", (_name, srcId, srcGroupId, target, expected) => {
		expect(groupDropOutcome({srcId, srcGroupId, target, lists: LISTS})).toStrictEqual(expected);
	});
});

describe("sectionDropOutcome", () => {
	const groupIds = ["A", "B", "C"];

	it.each<[string, string, SidebarDropTarget | null, ReturnType<typeof sectionDropOutcome>]>([
		["down onto a later header", "A", zone(groupHeaderZoneId("C")), {groupId: "A", toIndex: 2}],
		["up onto an earlier header", "C", zone(groupHeaderZoneId("A")), {groupId: "C", toIndex: 0}],
		["onto its own header", "B", zone(groupHeaderZoneId("B")), null],
		["onto the Ungrouped section", "A", zone(UNGROUPED_SECTION_ZONE), {groupId: "A", toIndex: 2}],
		["the last section onto Ungrouped", "C", zone(UNGROUPED_SECTION_ZONE), null],
		["onto an unknown header", "A", zone(groupHeaderZoneId("gone")), null],
		["onto a row slot", "A", slot("B", 0), null],
		["nowhere", "A", null, null],
	])("%s", (_name, groupId, target, expected) => {
		expect(sectionDropOutcome({groupId, target, groupIds})).toStrictEqual(expected);
	});

	it("round-trips a section drag id", () => {
		expect([sectionOfDragId(sectionDragId("cg-1")), sectionOfDragId("session-1")]).toStrictEqual(["cg-1", null]);
	});
});

describe("multiGroupDropOutcome", () => {
	it.each<
		[
			string,
			readonly string[],
			readonly (string | null)[],
			SidebarDropTarget | null,
			ReturnType<typeof multiGroupDropOutcome>,
		]
	>([
		[
			"rows at a group slot go before the next unselected head",
			["u1", "u2"],
			[null, null],
			slot("A", 1),
			{type: "group", groupId: "A", before: "a2"},
		],
		[
			"a slot whose next head is selected skips past it",
			["a2", "u1"],
			["A", null],
			slot("A", 1),
			{type: "group", groupId: "A", before: null},
		],
		[
			"rows on a group header go to its top",
			["u1", "u2"],
			[null, null],
			zone(groupHeaderZoneId("B")),
			{type: "group", groupId: "B", before: "b1"},
		],
		[
			"the Ungroup row ungroups when any row is grouped",
			["a1", "u1"],
			["A", null],
			zone(UNGROUP_ZONE),
			{type: "ungroup"},
		],
		[
			"the Ungrouped section is a no-op when nothing is grouped",
			["u1", "u2"],
			[null, null],
			zone(UNGROUPED_SECTION_ZONE),
			null,
		],
		[
			"the Pinned list cannot take a multi-row drag",
			["u1", "u2"],
			[null, null],
			{
				type: "slot",
				listId: "pinned",
				slot: 0,
			},
			null,
		],
		["the pin drop row cannot take a multi-row drag", ["u1", "u2"], [null, null], zone("pin-drop"), null],
		["no target", ["u1", "u2"], [null, null], null, null],
	])("%s", (_name, srcIds, srcGroupIds, target, expected) => {
		expect(multiGroupDropOutcome({srcIds, srcGroupIds, target, lists: LISTS})).toStrictEqual(expected);
	});
});
