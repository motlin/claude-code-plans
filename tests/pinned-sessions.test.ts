import {describe, expect, it} from "vite-plus/test";

import {
	PIN_DROP_OUTCOMES,
	dropOutcome,
	placePin,
	slotFromPointer,
	splitPinned,
	type PinDropOutcome,
} from "../src/lib/pinned-sessions";
import {slotFromPointer as sidebarSlotFromPointer} from "../src/lib/sidebar-drag";

interface Row {
	id: string;
	mtime: number;
}

const byMtimeDesc = (a: Row, b: Row) => b.mtime - a.mtime;

const sessions: Row[] = [
	{id: "session-alice", mtime: 1},
	{id: "session-bob", mtime: 2},
	{id: "session-carol", mtime: 3},
	{id: "session-dave", mtime: 4},
	{id: "session-erin", mtime: 5},
];

describe("splitPinned", () => {
	it("returns every session as rest when nothing is pinned", () => {
		expect(splitPinned(sessions, {pinnedIds: [], pinnedOrder: []}, byMtimeDesc)).toStrictEqual({
			pinned: [],
			rest: sessions,
		});
	});

	it("removes pinned sessions from rest, keeping rest in input order", () => {
		expect(
			splitPinned(sessions, {pinnedIds: ["session-bob", "session-dave"], pinnedOrder: []}, byMtimeDesc),
		).toStrictEqual({
			pinned: [
				{id: "session-dave", mtime: 4},
				{id: "session-bob", mtime: 2},
			],
			rest: [
				{id: "session-alice", mtime: 1},
				{id: "session-carol", mtime: 3},
				{id: "session-erin", mtime: 5},
			],
		});
	});

	it("puts user-ordered pins first, then unordered pins by the comparator", () => {
		expect(
			splitPinned(
				sessions,
				{
					pinnedIds: ["session-alice", "session-bob", "session-carol", "session-erin"],
					pinnedOrder: ["session-bob", "session-alice"],
				},
				byMtimeDesc,
			),
		).toStrictEqual({
			pinned: [
				{id: "session-bob", mtime: 2},
				{id: "session-alice", mtime: 1},
				{id: "session-erin", mtime: 5},
				{id: "session-carol", mtime: 3},
			],
			rest: [{id: "session-dave", mtime: 4}],
		});
	});

	it("ignores pinned or ordered ids that are not in the session list", () => {
		expect(
			splitPinned(
				sessions,
				{
					pinnedIds: ["session-gone", "session-carol"],
					pinnedOrder: ["session-gone"],
				},
				byMtimeDesc,
			),
		).toStrictEqual({
			pinned: [{id: "session-carol", mtime: 3}],
			rest: [
				{id: "session-alice", mtime: 1},
				{id: "session-bob", mtime: 2},
				{id: "session-dave", mtime: 4},
				{id: "session-erin", mtime: 5},
			],
		});
	});
});

describe("slotFromPointer", () => {
	it("is the shared sidebar drag geometry helper", () => {
		expect(slotFromPointer).toBe(sidebarSlotFromPointer);
	});
});

describe("dropOutcome", () => {
	it("lists every outcome", () => {
		expect(PIN_DROP_OUTCOMES).toStrictEqual(["pin", "reorder", "unpin", "cancel"]);
	});

	it.each<[string, Parameters<typeof dropOutcome>[0], PinDropOutcome]>([
		["recents row on a pinned slot pins", {srcPinned: false, slot: 0, belowPinnedBottom: false}, "pin"],
		["recents row on the last slot pins", {srcPinned: false, slot: 3, belowPinnedBottom: false}, "pin"],
		["recents row off the pinned zone cancels", {srcPinned: false, slot: null, belowPinnedBottom: false}, "cancel"],
		[
			"recents row below the pinned list cancels",
			{srcPinned: false, slot: null, belowPinnedBottom: true},
			"cancel",
		],
		[
			"recents row below the list ignores a stale slot",
			{srcPinned: false, slot: 2, belowPinnedBottom: true},
			"cancel",
		],
		["pinned row on another slot reorders", {srcPinned: true, slot: 0, belowPinnedBottom: false}, "reorder"],
		[
			"pinned row on its own or neighbour slot cancels",
			{srcPinned: true, slot: null, belowPinnedBottom: false},
			"cancel",
		],
		["pinned row below the list unpins", {srcPinned: true, slot: null, belowPinnedBottom: true}, "unpin"],
		[
			"pinned row below the list unpins despite a slot",
			{srcPinned: true, slot: 4, belowPinnedBottom: true},
			"unpin",
		],
	])("%s", (_label, input, expected) => {
		expect(dropOutcome(input)).toBe(expected);
	});
});

describe("placePin", () => {
	it("pins a new session at a displayed slot and makes the displayed order the user order", () => {
		expect(placePin({pinnedIds: ["a", "b"], pinnedOrder: []}, ["a", "b"], "c", 1)).toStrictEqual({
			pinnedIds: ["a", "b", "c"],
			pinnedOrder: ["a", "c", "b"],
		});
	});

	it("moves an already pinned session without duplicating it", () => {
		expect(placePin({pinnedIds: ["a", "b", "c"], pinnedOrder: ["a", "b"]}, ["a", "b", "c"], "a", 2)).toStrictEqual({
			pinnedIds: ["a", "b", "c"],
			pinnedOrder: ["b", "c", "a"],
		});
	});

	it("clamps the index and keeps ordered pins that are not displayed after the displayed ones", () => {
		expect(placePin({pinnedIds: ["a", "x"], pinnedOrder: ["x", "a"]}, ["a"], "b", 9)).toStrictEqual({
			pinnedIds: ["a", "x", "b"],
			pinnedOrder: ["a", "b", "x"],
		});
	});
});
