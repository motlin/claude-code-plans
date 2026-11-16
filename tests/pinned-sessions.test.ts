import {describe, expect, it} from "vite-plus/test";

import
{
	PIN_DROP_OUTCOMES,
	dropOutcome,
	placePin,
	slotFromPointer,
	splitPinned,
	type PinDropOutcome,
} from "../src/lib/pinned-sessions";
import {slotFromPointer as sidebarSlotFromPointer} from "../src/lib/sidebar-drag";

interface Row
{
	id: string;
	sessionId: string;
	forkedFromSessionId?: string;
	bucket: "done";
	archived: boolean;
	mtime: number;
}

function row(id: string, mtime: number, forkedFromSessionId?: string): Row
{
	return {
		id,
		sessionId: id,
		...(forkedFromSessionId === undefined
			? {}
			:
				{
					forkedFromSessionId,
				}),
		bucket: "done",
		archived: false,
		mtime,
	};
}

const byMtimeDesc = (a: Row, b: Row) => b.mtime - a.mtime;

const sessions: Row[] = [
	row("session-alice", 1),
	row("session-bob", 2),
	row("session-carol", 3),
	row("session-dave", 4),
	row("session-erin", 5),
];

describe("splitPinned", () =>
{
	it("returns every session as rest when nothing is pinned", () =>
	{
		expect(
			splitPinned(
				sessions,
				{
					pinnedIds: [],
					pinnedOrder: [],
				},
				byMtimeDesc,
			),
		).toStrictEqual(
			{
				pinned: [],
				nested: new Map(),
				rest: sessions,
			},
		);
	});

	it("removes pinned sessions from rest, keeping rest in input order", () =>
	{
		expect(
			splitPinned(
				sessions,
				{
					pinnedIds: ["session-bob", "session-dave"],
					pinnedOrder: [],
				},
				byMtimeDesc,
			),
		).toStrictEqual(
			{
				pinned: [row("session-dave", 4), row("session-bob", 2)],
				nested: new Map(),
				rest: [row("session-alice", 1), row("session-carol", 3), row("session-erin", 5)],
			},
		);
	});

	it("puts user-ordered pins first, then unordered pins by the comparator", () =>
	{
		expect(
			splitPinned(
				sessions,
				{
					pinnedIds: ["session-alice", "session-bob", "session-carol", "session-erin"],
					pinnedOrder: ["session-bob", "session-alice"],
				},
				byMtimeDesc,
			),
		).toStrictEqual(
			{
				pinned: [
					row("session-bob", 2),
					row("session-alice", 1),
					row("session-erin", 5),
					row("session-carol", 3),
				],
				nested: new Map(),
				rest: [row("session-dave", 4)],
			},
		);
	});

	it("ignores pinned or ordered ids that are not in the session list", () =>
	{
		expect(
			splitPinned(
				sessions,
				{
					pinnedIds: ["session-gone", "session-carol"],
					pinnedOrder: ["session-gone"],
				},
				byMtimeDesc,
			),
		).toStrictEqual(
			{
				pinned: [row("session-carol", 3)],
				nested: new Map(),
				rest: [row("session-alice", 1), row("session-bob", 2), row("session-dave", 4), row("session-erin", 5)],
			},
		);
	});
});

describe("splitPinned with families", () =>
{
	// h1 ← c1 ← g1 and h2 ← c2; newer rows have a larger mtime.
	const family = [row("h1", 50), row("c1", 40, "h1"), row("g1", 30, "c1"), row("h2", 20), row("c2", 10, "h2")];
	const ids = (rows: readonly Row[]) => rows.map((entry) => entry.id);
	const nestedIds = (nested: ReadonlyMap<string, Row[]>) =>
		[...nested].map(([head, members]): [string, string[]] => [head, ids(members)]);
	const split = (rows: readonly Row[], pinnedIds: string[]) =>
	{
		const result = splitPinned(
			rows,
			{
				pinnedIds,
				pinnedOrder: [],
			},
			byMtimeDesc,
		);
		return {
			pinned: ids(result.pinned),
			nested: nestedIds(result.nested),
			rest: ids(result.rest),
		};
	};

	it("moves a pinned head's whole family into Pinned, nested under it", () =>
	{
		expect(split(family, ["h1"])).toStrictEqual(
			{
				pinned: ["h1"],
				nested: [["h1", ["c1", "g1"]]],
				rest: ["h2", "c2"],
			},
		);
	});

	it("nests a pinned member under its pinned head instead of giving it a slot", () =>
	{
		expect(split(family, ["h1", "c1"])).toStrictEqual(
			{
				pinned: ["h1"],
				nested: [["h1", ["c1", "g1"]]],
				rest: ["h2", "c2"],
			},
		);
	});

	it("keeps a pinned fork whose head is not pinned as a flat slot", () =>
	{
		expect(split(family, ["c2"])).toStrictEqual(
			{
				pinned: ["c2"],
				nested: [],
				rest: ["h1", "c1", "g1", "h2"],
			},
		);
	});

	it("orders siblings by the comparator, each member after its parent", () =>
	{
		expect(split([...family, row("c1b", 45, "h1")], ["h1"])).toStrictEqual(
			{
				pinned: ["h1"],
				nested: [["h1", ["c1b", "c1", "g1"]]],
				rest: ["h2", "c2"],
			},
		);
	});

	it("nests nothing when nothing is pinned", () =>
	{
		expect(
			splitPinned(
				family,
				{
					pinnedIds: [],
					pinnedOrder: [],
				},
				byMtimeDesc,
			),
		).toStrictEqual(
			{
				pinned: [],
				nested: new Map(),
				rest: family,
			},
		);
	});
});

describe("slotFromPointer", () =>
{
	it("is the shared sidebar drag geometry helper", () =>
	{
		expect(slotFromPointer).toBe(sidebarSlotFromPointer);
	});
});

describe("dropOutcome", () =>
{
	it("lists every outcome", () =>
	{
		expect(PIN_DROP_OUTCOMES).toStrictEqual(["pin", "reorder", "unpin", "cancel"]);
	});

	it.each<[string, Parameters<typeof dropOutcome>[0], PinDropOutcome]>([
		[
			"recents row on a pinned slot pins",
			{
				srcPinned: false,
				slot: 0,
				belowPinnedBottom: false,
			},
			"pin",
		],
		[
			"recents row on the last slot pins",
			{
				srcPinned: false,
				slot: 3,
				belowPinnedBottom: false,
			},
			"pin",
		],
		[
			"recents row off the pinned zone cancels",
			{
				srcPinned: false,
				slot: null,
				belowPinnedBottom: false,
			},
			"cancel",
		],
		[
			"recents row below the pinned list cancels",
			{
				srcPinned: false,
				slot: null,
				belowPinnedBottom: true,
			},
			"cancel",
		],
		[
			"recents row below the list ignores a stale slot",
			{
				srcPinned: false,
				slot: 2,
				belowPinnedBottom: true,
			},
			"cancel",
		],
		[
			"pinned row on another slot reorders",
			{
				srcPinned: true,
				slot: 0,
				belowPinnedBottom: false,
			},
			"reorder",
		],
		[
			"pinned row on its own or neighbour slot cancels",
			{
				srcPinned: true,
				slot: null,
				belowPinnedBottom: false,
			},
			"cancel",
		],
		[
			"pinned row below the list unpins",
			{
				srcPinned: true,
				slot: null,
				belowPinnedBottom: true,
			},
			"unpin",
		],
		[
			"pinned row below the list unpins despite a slot",
			{
				srcPinned: true,
				slot: 4,
				belowPinnedBottom: true,
			},
			"unpin",
		],
	])("%s", (_label, input, expected) =>
	{
		expect(dropOutcome(input)).toBe(expected);
	});
});

describe("placePin", () =>
{
	it("pins a new session at a displayed slot and makes the displayed order the user order", () =>
	{
		expect(
			placePin(
				{
					pinnedIds: ["a", "b"],
					pinnedOrder: [],
				},
				["a", "b"],
				"c",
				1,
			),
		).toStrictEqual(
			{
				pinnedIds: ["a", "b", "c"],
				pinnedOrder: ["a", "c", "b"],
			},
		);
	});

	it("moves an already pinned session without duplicating it", () =>
	{
		expect(
			placePin(
				{
					pinnedIds: ["a", "b", "c"],
					pinnedOrder: ["a", "b"],
				},
				["a", "b", "c"],
				"a",
				2,
			),
		).toStrictEqual(
			{
				pinnedIds: ["a", "b", "c"],
				pinnedOrder: ["b", "c", "a"],
			},
		);
	});

	it("clamps the index and keeps ordered pins that are not displayed after the displayed ones", () =>
	{
		expect(
			placePin(
				{
					pinnedIds: ["a", "x"],
					pinnedOrder: ["x", "a"],
				},
				["a"],
				"b",
				9,
			),
		).toStrictEqual(
			{
				pinnedIds: ["a", "x", "b"],
				pinnedOrder: ["a", "b", "x"],
			},
		);
	});
});
