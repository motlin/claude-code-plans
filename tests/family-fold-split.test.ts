import {describe, expect, it} from "vite-plus/test";

import {nextFoldOpenKeys, splitFoldedFamily} from "../src/lib/family-fold";
import type {SessionBucket} from "../src/lib/session-state";

function row(sessionId: string, bucket: SessionBucket, unseenError?: true)
{
	return {
		sessionId,
		bucket,
		session:
			unseenError === undefined
				? {}
				:
					{
						unseenError,
					},
	};
}

const C1 = row("c1", "blocked");
const C2 = row("c2", "done");
const G1 = row("g1", "blocked", true);
const C3 = row("c3", "working");
const NESTED = [C1, C2, G1, C3];
const NONE =
{
	pinnedIds: [],
	openKeys: new Set<string>(),
};

describe("splitFoldedFamily", () =>
{
	it("keeps every row of an unfolded family", () =>
	{
		expect(
			splitFoldedFamily(
				NESTED,
				{
					...NONE,
					collapsed: false,
				},
			),
		).toStrictEqual(
			{
				kept: NESTED,
				hidden: [],
			},
		);
	});

	it("hides awaiting, failed and settled rows of a folded family", () =>
	{
		expect(
			splitFoldedFamily(
				NESTED,
				{
					...NONE,
					collapsed: true,
				},
			),
		).toStrictEqual(
			{
				kept: [],
				hidden: [C1, C2, G1, C3],
			},
		);
	});

	it("keeps pinned and open rows in their original order", () =>
	{
		expect([
			splitFoldedFamily(
				NESTED,
				{
					...NONE,
					collapsed: true,
					pinnedIds: ["c2"],
				},
			),
			splitFoldedFamily(
				NESTED,
				{
					...NONE,
					collapsed: true,
					openKeys: new Set(["c3"]),
				},
			),
			splitFoldedFamily(
				[C1, C2],
				{
					collapsed: true,
					pinnedIds: ["c2"],
					openKeys: new Set(),
				},
			),
		]).toStrictEqual([
			{
				kept: [C2],
				hidden: [C1, G1, C3],
			},
			{
				kept: [C3],
				hidden: [C1, C2, G1],
			},
			{
				kept: [C2],
				hidden: [C1],
			},
		]);
	});
});

describe("nextFoldOpenKeys", () =>
{
	it("unions open keys while the fold state holds and resets when it changes", () =>
	{
		const K1 = ["code:h1"];
		const K2 = ["code:h1", "code:h2"];
		const latched = nextFoldOpenKeys(
			{
				keys: K1,
				open: new Set(["a"]),
			},
			{
				collapsedFamilies: K1,
				open: ["b"],
			},
		);
		const unchanged =
		{
			keys: K1,
			open: new Set(["a"]),
		};

		expect(
			{
				latched,
				same:
					nextFoldOpenKeys(
						unchanged,
						{
							collapsedFamilies: [...K1],
							open: ["a"],
						},
					) === unchanged,
				reset: nextFoldOpenKeys(
					latched,
					{
						collapsedFamilies: K2,
						open: ["b"],
					},
				),
				empty: nextFoldOpenKeys(
					latched,
					{
						collapsedFamilies: [],
						open: ["b"],
					},
				),
			},
		).toStrictEqual(
			{
				latched:
				{
					keys: K1,
					open: new Set(["a", "b"]),
				},
				same: true,
				reset:
				{
					keys: K2,
					open: new Set(["b"]),
				},
				empty:
				{
					keys: [],
					open: new Set(),
				},
			},
		);
	});
});
