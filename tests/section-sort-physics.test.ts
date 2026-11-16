import {describe, expect, it} from "vite-plus/test";

import {clampSectionDrag, liftedInsets, sectionDragBounds, sectionSlotForOffset} from "../src/lib/section-sort-physics";

function box(
	top: number,
	bottom: number,
	left = 0,
):
{
	top: number;
	bottom: number;
	left: number;
}
{
	return {
		top,
		bottom,
		left,
	};
}

describe("sectionSlotForOffset (upstream `IX`)", () =>
{
	it.each<[string, number, number, number]>([
		["stays put before the next section's midpoint", 0, 15, 0],
		["passes the next section's midpoint going down", 0, 25, 1],
		["passes both earlier midpoints going up", 2, -70, 0],
		["passes one earlier midpoint going up", 2, -30, 1],
		["counts nothing for no offset", 1, 0, 1],
	])("%s", (_, index, dy, slot) =>
	{
		expect(sectionSlotForOffset([0, 40, 80], [40, 40, 40], index, dy)).toBe(slot);
	});
});

describe("clampSectionDrag", () =>
{
	it.each<[string, number, number, number]>([
		["pins x and clamps y to the top bound", -500, 0, -40],
		["shifts the bounds by the scroll since the drag started", -500, 10, -50],
		["clamps y to the bottom bound", 500, 0, 40],
		["keeps a y inside the bounds", 12, 0, 12],
	])("%s", (_, y, scrollTopNow, clampedY) =>
	{
		expect(
			clampSectionDrag(
				{
					x: 12,
					y,
					scaleX: 1,
					scaleY: 1,
				},
				{
					up: -40,
					down: 40,
					scrollTop: 0,
				},
				scrollTopNow,
			),
		).toStrictEqual(
			{
				x: 0,
				y: clampedY,
				scaleX: 1,
				scaleY: 1,
			},
		);
	});
});

describe("sectionDragBounds (upstream `w`)", () =>
{
	it("spans from the first section's top to the last one's bottom", () =>
	{
		expect(sectionDragBounds(box(100, 150), [box(20, 90), box(100, 150), box(160, 260)])).toStrictEqual(
			{
				up: -80,
				down: 110,
			},
		);
	});
});

describe("liftedInsets (upstream `ij`)", () =>
{
	it("ends 10px below the name on a header-only section", () =>
	{
		expect(liftedInsets(box(100, 137, 0), box(104, 136, 8), box(112, 128, 20), 6)).toStrictEqual(
			{
				top: 2,
				x: 4,
				bottom: -1,
			},
		);
	});

	it("tucks 3px under the header's bottom when rows follow it", () =>
	{
		expect(liftedInsets(box(100, 240, 0), box(104, 136, 8), box(112, 128, 20), 6)).toStrictEqual(
			{
				top: 2,
				x: 4,
				bottom: -3,
			},
		);
	});
});
