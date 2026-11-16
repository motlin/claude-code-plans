import {describe, expect, it} from "vite-plus/test";

import {revealThrough, withHeads} from "../src/lib/sidebar-section-reveal";

const KEYS = Array.from(
	{
		length: 12,
	},
	(_, index) => `k${index}`,
);

function reveal(overrides: Partial<Parameters<typeof revealThrough>[0]> = {}): number
{
	return revealThrough(
		{
			keys: KEYS,
			truncateAt: 5,
			extraRevealed: 0,
			hiddenCount: 7,
			collapsed: false,
			openKeys: new Set(),
			...overrides,
		},
	);
}

describe("revealThrough (upstream AE)", () =>
{
	it("reveals through the last open, reveal and landed row past the shown range, never shrinking", () =>
	{
		expect(
			{
				openPastCap: reveal(
					{
						openKeys: new Set(["k8"]),
					},
				),
				openInsideCap: reveal(
					{
						openKeys: new Set(["k2"]),
					},
				),
				lastOpenWins: reveal(
					{
						openKeys: new Set(["k8", "k10"]),
					},
				),
				collapsed: reveal(
					{
						openKeys: new Set(["k8"]),
						collapsed: true,
					},
				),
				nothingHidden: reveal(
					{
						openKeys: new Set(["k8"]),
						extraRevealed: 7,
						hiddenCount: 0,
					},
				),
				revealKey: reveal(
					{
						revealKey: "k7",
					},
				),
				landed: reveal(
					{
						landedKeys: new Set(["k6", "k9"]),
					},
				),
				neverBelowExtra: reveal(
					{
						openKeys: new Set(["k6"]),
						extraRevealed: 3,
						hiddenCount: 4,
					},
				),
			},
		).toStrictEqual(
			{
				openPastCap: 4,
				openInsideCap: 0,
				lastOpenWins: 6,
				collapsed: 0,
				nothingHidden: 7,
				revealKey: 3,
				landed: 5,
				neverBelowExtra: 3,
			},
		);
	});

	it("adds each nested key's family head, as upstream's heldBy", () =>
	{
		expect([...withHeads(["fork", "loose"], new Map([["fork", "head"]]))]).toStrictEqual(["fork", "head", "loose"]);
	});
});
