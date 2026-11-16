import {describe, expect, it} from "vite-plus/test";

import
{
	foldBudget,
	foldPass,
	freeAfterTitle,
	nextHidden,
	overflowShortfall,
	pillsCompact,
	splitPanes,
	type FoldState,
} from "../src/lib/titlebar-fold";

const changes =
{
	name: "Changes",
	active: false,
};
const files =
{
	name: "Files",
	active: false,
};
const changesOpen =
{
	name: "Changes",
	active: true,
};

function names(split: {
	folded: ReadonlyArray<
	{
		name: string;
	}>;
	inline: ReadonlyArray<
	{
		name: string;
	}>;
})
{
	return {
		folded: split.folded.map((pane) => pane.name),
		inline: split.inline.map((pane) => pane.name),
	};
}

describe("splitPanes (upstream G_)", () =>
{
	it("folds inactive panes first, in list order, keeping the inline order", () =>
	{
		expect(
			{
				none: names(splitPanes([changes, files], 0)),
				one: names(splitPanes([changes, files], 1)),
				oneWithChangesOpen: names(splitPanes([changesOpen, files], 1)),
				two: names(splitPanes([changesOpen, files], 2)),
				tooMany: names(splitPanes([changes, files], 5)),
				negative: names(splitPanes([changes, files], -1)),
			},
		).toStrictEqual(
			{
				none:
				{
					folded: [],
					inline: ["Changes", "Files"],
				},
				one:
				{
					folded: ["Changes"],
					inline: ["Files"],
				},
				oneWithChangesOpen:
				{
					folded: ["Files"],
					inline: ["Changes"],
				},
				two:
				{
					folded: ["Changes", "Files"],
					inline: [],
				},
				tooMany:
				{
					folded: ["Changes", "Files"],
					inline: [],
				},
				negative:
				{
					folded: [],
					inline: ["Changes", "Files"],
				},
			},
		);
	});
});

describe("foldBudget (upstream en)", () =>
{
	it("folds the panes first, then the rail toggle once every pane slot is folded", () =>
	{
		expect(
			{
				railNone: foldBudget(
					{
						railToggleFoldable: true,
						hiddenCount: 0,
					},
				),
				railOne: foldBudget(
					{
						railToggleFoldable: true,
						hiddenCount: 1,
					},
				),
				railSix: foldBudget(
					{
						railToggleFoldable: true,
						hiddenCount: 6,
					},
				),
				railSeven: foldBudget(
					{
						railToggleFoldable: true,
						hiddenCount: 7,
					},
				),
				noRailTwo: foldBudget(
					{
						railToggleFoldable: false,
						hiddenCount: 2,
					},
				),
				noPaneSlots: foldBudget(
					{
						railToggleFoldable: true,
						paneSlots: 0,
						hiddenCount: 1,
					},
				),
			},
		).toStrictEqual(
			{
				railNone:
				{
					maxHidden: 7,
					railToggleFolded: false,
					hiddenMainPanes: 0,
				},
				railOne:
				{
					maxHidden: 7,
					railToggleFolded: false,
					hiddenMainPanes: 1,
				},
				railSix:
				{
					maxHidden: 7,
					railToggleFolded: false,
					hiddenMainPanes: 6,
				},
				railSeven:
				{
					maxHidden: 7,
					railToggleFolded: true,
					hiddenMainPanes: 6,
				},
				noRailTwo:
				{
					maxHidden: 6,
					railToggleFolded: false,
					hiddenMainPanes: 2,
				},
				noPaneSlots:
				{
					maxHidden: 1,
					railToggleFolded: true,
					hiddenMainPanes: 0,
				},
			},
		);
	});
});

describe("hide/reveal maths (upstream Wt, Kt, Gt)", () =>
{
	it("hides ceil(-free/step) more and reveals floor((free-24)/step), capped", () =>
	{
		expect(
			{
				hideTwo: nextHidden(-31, 30, 0, 7),
				revealOne: nextHidden(55, 30, 2, 7),
				holdBelowReveal: nextHidden(53, 30, 2, 7),
				holdAtSlack: nextHidden(-1, 30, 0, 7),
				cappedAtMax: nextHidden(-200, 30, 5, 7),
				atMax: nextHidden(-200, 30, 7, 7),
				revealCappedAtHidden: nextHidden(500, 30, 2, 7),
				defaultMax: nextHidden(-1000, 30, 0),
			},
		).toStrictEqual(
			{
				hideTwo: 2,
				revealOne: -1,
				holdBelowReveal: 0,
				holdAtSlack: 0,
				cappedAtMax: 2,
				atMax: 0,
				revealCappedAtHidden: -2,
				defaultMax: 6,
			},
		);
	});

	it("lets the title keep up to 160px of its natural width, or a given claim", () =>
	{
		expect(
			{
				longTitle: freeAfterTitle(
					{
						freePx: 0,
						titleClientPx: 60,
						titleNaturalPx: 300,
						shortfallPx: 0,
					},
				),
				shortTitle: freeAfterTitle(
					{
						freePx: 10,
						titleClientPx: 40,
						titleNaturalPx: 40,
						shortfallPx: 0,
					},
				),
				shortfall: freeAfterTitle(
					{
						freePx: 0,
						titleClientPx: 120,
						titleNaturalPx: 300,
						shortfallPx: 5,
					},
				),
				railClaim: freeAfterTitle(
					{
						freePx: 0,
						titleClientPx: 60,
						titleNaturalPx: 300,
						claimPx: 100,
					},
				),
			},
		).toStrictEqual(
			{
				longTitle: -100,
				shortTitle: 10,
				shortfall: -45,
				railClaim: -40,
			},
		);
	});

	it("counts the title spilling past its cluster and the last child spilling past the row", () =>
	{
		expect(
			{
				none: overflowShortfall(
					{
						titleEnd: 100,
						leadEnd: 120,
						lastEnd: 300,
						rowEnd: 310,
					},
				),
				both: overflowShortfall(
					{
						titleEnd: 130,
						leadEnd: 120,
						lastEnd: 320,
						rowEnd: 310,
					},
				),
				unknown: overflowShortfall(
					{
						titleEnd: 130,
						leadEnd: undefined,
						lastEnd: undefined,
						rowEnd: 310,
					},
				),
			},
		).toStrictEqual(
			{
				none: 0,
				both: 20,
				unknown: 0,
			},
		);
	});
});

describe("pillsCompact (upstream qt)", () =>
{
	const base =
	{
		freePx: 0,
		titleClientPx: 50,
		titleNaturalPx: 100,
		hidden: 0,
		pillBudget: 0,
		pillBudgetAtCollapse: 0,
	};

	it("compacts once there is no free space and the title truncates", () =>
	{
		expect(
			{
				truncatedNoFree: pillsCompact(false, base),
				halfPixelFree: pillsCompact(
					false,
					{
						...base,
						freePx: 0.5,
					},
				),
				someFree: pillsCompact(
					false,
					{
						...base,
						freePx: 1,
					},
				),
				titleWhole: pillsCompact(
					false,
					{
						...base,
						titleClientPx: 100,
					},
				),
			},
		).toStrictEqual(
			{
				truncatedNoFree: true,
				halfPixelFree: true,
				someFree: false,
				titleWhole: false,
			},
		);
	});

	it("re-expands only with nothing hidden, the pill budget grown past 1px, and 96px free", () =>
	{
		const roomy =
		{
			...base,
			freePx: 96,
			pillBudget: 2,
			pillBudgetAtCollapse: 0,
		};
		expect(
			{
				roomy: pillsCompact(true, roomy),
				hidden: pillsCompact(
					true,
					{
						...roomy,
						hidden: 1,
					},
				),
				budgetFlat: pillsCompact(
					true,
					{
						...roomy,
						pillBudget: 1,
					},
				),
				tight: pillsCompact(
					true,
					{
						...roomy,
						freePx: 95,
					},
				),
			},
		).toStrictEqual(
			{
				roomy: false,
				hidden: true,
				budgetFlat: true,
				tight: true,
			},
		);
	});
});

describe("foldPass (upstream Jt's measure step)", () =>
{
	const rest: FoldState =
	{
		hidden: 0,
		compact: false,
		pillBudgetAtCollapse: -Infinity,
		compactedThisBurst: false,
	};
	const budget =
	{
		maxHidden: 7,
		paneSlots: 6,
	};
	const tight =
	{
		freePx: 0,
		otherPx: 100,
		shortfallPx: 0,
		titleNaturalPx: 200,
		rootPx: 400,
		stepPx: 30,
	};

	it("folds a pane under the 160px title claim but the rail only under the 100px claim", () =>
	{
		const compactRest: FoldState =
		{
			...rest,
			compact: true,
			pillBudgetAtCollapse: 0,
		};
		expect(
			{
				paneTier: foldPass(
					{
						...tight,
						titleClientPx: 150,
					},
					compactRest,
					budget,
				).hidden,
				railHolds: foldPass(
					{
						...tight,
						titleClientPx: 150,
					},
					{
						...compactRest,
						hidden: 6,
					},
					budget,
				).hidden,
				railFolds: foldPass(
					{
						...tight,
						titleClientPx: 90,
					},
					{
						...compactRest,
						hidden: 6,
					},
					budget,
				).hidden,
			},
		).toStrictEqual(
			{
				paneTier: 1,
				railHolds: 6,
				railFolds: 7,
			},
		);
	});

	it("reveals the rail before any pane once the title has room", () =>
	{
		expect(
			foldPass(
				{
					...tight,
					freePx: 60,
					titleClientPx: 200,
				},
				{
					...rest,
					hidden: 7,
				},
				budget,
			).hidden,
		).toBe(6);
	});

	it("compacts the pills and hides panes when the title drops under its 160px claim", () =>
	{
		expect(
			foldPass(
				{
					freePx: 0,
					otherPx: 200,
					shortfallPx: 0,
					titleClientPx: 40,
					titleNaturalPx: 180,
					rootPx: 300,
					stepPx: 30,
				},
				rest,
				budget,
			),
		).toStrictEqual(
			{
				hidden: 4,
				compact: true,
				pillBudgetAtCollapse: -80,
				compactedThisBurst: true,
			},
		);
	});

	it("refuses to re-expand the pills in the same burst that compacted them", () =>
	{
		expect(
			foldPass(
				{
					freePx: 200,
					otherPx: 100,
					shortfallPx: 0,
					titleClientPx: 180,
					titleNaturalPx: 180,
					rootPx: 600,
					stepPx: 30,
				},
				{
					hidden: 0,
					compact: true,
					pillBudgetAtCollapse: -80,
					compactedThisBurst: true,
				},
				budget,
			),
		).toStrictEqual(
			{
				hidden: 0,
				compact: true,
				pillBudgetAtCollapse: 324,
				compactedThisBurst: true,
			},
		);
	});

	it("re-expands after the burst settles and reveals hidden buttons when there is room", () =>
	{
		expect(
			foldPass(
				{
					freePx: 200,
					otherPx: 100,
					shortfallPx: 0,
					titleClientPx: 180,
					titleNaturalPx: 180,
					rootPx: 600,
					stepPx: 30,
				},
				{
					hidden: 0,
					compact: true,
					pillBudgetAtCollapse: -80,
					compactedThisBurst: false,
				},
				budget,
			),
		).toStrictEqual(
			{
				hidden: 0,
				compact: false,
				pillBudgetAtCollapse: -Infinity,
				compactedThisBurst: false,
			},
		);
	});
});
