import {describe, expect, it} from "vite-plus/test";

import
{
	adoptShownCount,
	reduceSectionView,
	revealStep,
	type SectionView,
	type SectionViewInput,
} from "../src/lib/sidebar-section-hold";

interface Row
{
	sessionId: string;
}

const ROWS = new Map(
	["A", "B", "C", "D", "E", "F", "G", "H"].map((key) => [
		key,
		{
			sessionId: key,
		},
	]),
);

function rows(order: string): Row[]
{
	return order.split("").map((key) =>
	{
		const row = ROWS.get(key);
		if (row === undefined) throw new Error(key);
		return row;
	});
}

function keys(view: SectionView<Row>): string
{
	return view.visible.map((row) => row.sessionId).join("");
}

const BASE = rows("ABCDEFGH");

function input(overrides: Partial<SectionViewInput<Row>> = {}): SectionViewInput<Row>
{
	return {
		epoch: "e",
		order: "activity:desc",
		sortMenuOpen: false,
		sorted: BASE,
		truncateAt: 5,
		extraRevealed: 0,
		focusedRowKey: null,
		menuOpen: false,
		...overrides,
	};
}

function summary(view: SectionView<Row>)
{
	return {
		visible: keys(view),
		hiddenCount: view.hiddenCount,
		holding: view.holding,
		focusHeld: view.focusHeld,
		extraRevealed: view.extraRevealed,
	};
}

const RESORTED = rows("ABCDFGEH");

describe("reduceSectionView (upstream B5/hk)", () =>
{
	it("re-truncates a live re-sort at once with no menu open or row focused", () =>
	{
		const rest = reduceSectionView(input(), null);
		expect(
			summary(
				reduceSectionView(
					input(
						{
							sorted: RESORTED,
						},
					),
					rest,
				),
			),
		).toStrictEqual(
			{
				visible: "ABCDF",
				hiddenCount: 3,
				holding: false,
				focusHeld: false,
				extraRevealed: 0,
			},
		);
	});

	it("holds the shown rows in sorted order while a menu is open, until the first re-sort after it closes", () =>
	{
		const rest = reduceSectionView(input(), null);
		const opened = reduceSectionView(
			input(
				{
					menuOpen: true,
				},
			),
			rest,
		);
		const held = reduceSectionView(
			input(
				{
					menuOpen: true,
					sorted: RESORTED,
				},
			),
			opened,
		);
		const closed = reduceSectionView(
			input(
				{
					sorted: RESORTED,
				},
			),
			held,
		);
		const refreshed = reduceSectionView(
			input(
				{
					sorted: [...RESORTED],
				},
			),
			closed,
		);
		expect(
			{
				openedKeepsView: opened === rest,
				held: summary(held),
				baseline: [...held.baseline].join(""),
				closedKeepsView: closed === held,
				refreshed: summary(refreshed),
			},
		).toStrictEqual(
			{
				openedKeepsView: true,
				held:
				{
					visible: "ABCDFE",
					hiddenCount: 2,
					holding: true,
					focusHeld: false,
					extraRevealed: 0,
				},
				baseline: "ABCDE",
				closedKeepsView: true,
				refreshed:
				{
					visible: "ABCDF",
					hiddenCount: 3,
					holding: false,
					focusHeld: false,
					extraRevealed: 0,
				},
			},
		);
	});

	it("holds a focused row with no menu, and adopts it into extraRevealed at the first re-sort after focus leaves", () =>
	{
		const rest = reduceSectionView(input(), null);
		const focused = reduceSectionView(
			input(
				{
					focusedRowKey: "E",
				},
			),
			rest,
		);
		const held = reduceSectionView(
			input(
				{
					focusedRowKey: "E",
					sorted: RESORTED,
				},
			),
			focused,
		);
		const blurred = reduceSectionView(
			input(
				{
					sorted: [...RESORTED],
				},
			),
			held,
		);
		const rerendered = reduceSectionView(
			input(
				{
					sorted: [...RESORTED],
				},
			),
			blurred,
		);
		expect(
			{
				held: summary(held),
				blurred: summary(blurred),
				rerendered: summary(rerendered),
			},
		).toStrictEqual(
			{
				held:
				{
					visible: "ABCDFE",
					hiddenCount: 2,
					holding: true,
					focusHeld: true,
					extraRevealed: 0,
				},
				blurred:
				{
					visible: "ABCDFGEH",
					hiddenCount: 0,
					holding: false,
					focusHeld: false,
					extraRevealed: 2,
				},
				rerendered:
				{
					visible: "ABCDFGEH",
					hiddenCount: 0,
					holding: false,
					focusHeld: false,
					extraRevealed: 2,
				},
			},
		);
	});

	it("drops the hold when Sort by changes from the open Group and sort menu, but not from a row menu", () =>
	{
		const rest = reduceSectionView(input(), null);
		const fromSortMenu = reduceSectionView(
			input(
				{
					menuOpen: true,
					sortMenuOpen: true,
					order: "name:asc",
					sorted: RESORTED,
				},
			),
			rest,
		);
		const fromRowMenu = reduceSectionView(
			input(
				{
					menuOpen: true,
					order: "name:asc",
					sorted: RESORTED,
				},
			),
			rest,
		);
		expect(
			{
				fromSortMenu: summary(fromSortMenu),
				sortBaseline: [...fromSortMenu.baseline].join(""),
				fromRowMenu: summary(fromRowMenu),
			},
		).toStrictEqual(
			{
				fromSortMenu:
				{
					visible: "ABCDF",
					hiddenCount: 3,
					holding: false,
					focusHeld: false,
					extraRevealed: 0,
				},
				sortBaseline: "ABCDF",
				fromRowMenu:
				{
					visible: "ABCDFE",
					hiddenCount: 2,
					holding: true,
					focusHeld: false,
					extraRevealed: 0,
				},
			},
		);
	});

	it("drops the baseline on a new epoch, and keeps the visible array when the rows shown are the same", () =>
	{
		const rest = reduceSectionView(input(), null);
		const newEpoch = reduceSectionView(
			input(
				{
					epoch: "f",
					menuOpen: true,
					sorted: RESORTED,
				},
			),
			rest,
		);
		const sameShown = reduceSectionView(
			input(
				{
					sorted: rows("ABCDEHGF"),
				},
			),
			rest,
		);
		expect(
			{
				newEpoch: summary(newEpoch),
				sameVisibleArray: sameShown.visible === rest.visible,
			},
		).toStrictEqual(
			{
				newEpoch:
				{
					visible: "ABCDF",
					hiddenCount: 3,
					holding: false,
					focusHeld: false,
					extraRevealed: 0,
				},
				sameVisibleArray: true,
			},
		);
	});
});

describe("adoptShownCount (upstream gy) and revealStep (upstream B7)", () =>
{
	it("grows extraRevealed through previously shown rows, skipping at most truncateAt unseen rows", () =>
	{
		expect(
			{
				adopted: adoptShownCount(RESORTED, 5, 0, new Set(["A", "B", "C", "D", "E"])),
				farPastCap: adoptShownCount(rows("ABCDFGHE"), 2, 0, new Set(["A", "B", "E"])),
				untruncated: adoptShownCount(rows("ABCDEF"), 5, 0, new Set(["A"])),
			},
		).toStrictEqual(
			{
				adopted: 2,
				farPastCap: 0,
				untruncated: 0,
			},
		);
	});

	it("counts the held rows already shown past the cutoff, so Show more reveals a page of unseen rows", () =>
	{
		const sorted = RESORTED;
		expect(
			{
				held: revealStep(sorted, rows("ABCDFE"), 5, 5),
				plain: revealStep(sorted, sorted.slice(0, 5), 5, 5),
			},
		).toStrictEqual(
			{
				held: 1,
				plain: 0,
			},
		);
	});
});
