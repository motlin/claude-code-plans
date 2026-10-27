import {describe, expect, it} from "vite-plus/test";

import {
	foldBudget,
	foldPass,
	freeAfterTitle,
	nextHidden,
	overflowShortfall,
	pillsCompact,
	splitPanes,
	type FoldState,
} from "../src/lib/titlebar-fold";

const changes = {name: "Changes", active: false};
const files = {name: "Files", active: false};
const changesOpen = {name: "Changes", active: true};

function names(split: {folded: ReadonlyArray<{name: string}>; inline: ReadonlyArray<{name: string}>}) {
	return {folded: split.folded.map((pane) => pane.name), inline: split.inline.map((pane) => pane.name)};
}

describe("splitPanes (upstream G_)", () => {
	it("folds inactive panes first, in list order, keeping the inline order", () => {
		expect({
			none: names(splitPanes([changes, files], 0)),
			one: names(splitPanes([changes, files], 1)),
			oneWithChangesOpen: names(splitPanes([changesOpen, files], 1)),
			two: names(splitPanes([changesOpen, files], 2)),
			tooMany: names(splitPanes([changes, files], 5)),
			negative: names(splitPanes([changes, files], -1)),
		}).toStrictEqual({
			none: {folded: [], inline: ["Changes", "Files"]},
			one: {folded: ["Changes"], inline: ["Files"]},
			oneWithChangesOpen: {folded: ["Files"], inline: ["Changes"]},
			two: {folded: ["Changes", "Files"], inline: []},
			tooMany: {folded: ["Changes", "Files"], inline: []},
			negative: {folded: [], inline: ["Changes", "Files"]},
		});
	});
});

describe("foldBudget (upstream zt)", () => {
	it("folds the rail toggle first when it can fold", () => {
		expect({
			railOne: foldBudget({railToggleFoldable: true, hiddenCount: 1}),
			railNone: foldBudget({railToggleFoldable: true, hiddenCount: 0}),
			railThree: foldBudget({railToggleFoldable: true, hiddenCount: 3}),
			noRailTwo: foldBudget({railToggleFoldable: false, hiddenCount: 2}),
		}).toStrictEqual({
			railOne: {maxHidden: 7, railToggleFolded: true, hiddenMainPanes: 0},
			railNone: {maxHidden: 7, railToggleFolded: false, hiddenMainPanes: 0},
			railThree: {maxHidden: 7, railToggleFolded: true, hiddenMainPanes: 2},
			noRailTwo: {maxHidden: 6, railToggleFolded: false, hiddenMainPanes: 2},
		});
	});
});

describe("hide/reveal maths (upstream Wt, Kt, Gt)", () => {
	it("hides ceil(-free/step) more and reveals floor((free-24)/step), capped", () => {
		expect({
			hideTwo: nextHidden(-31, 30, 0, 7),
			revealOne: nextHidden(55, 30, 2, 7),
			holdBelowReveal: nextHidden(53, 30, 2, 7),
			holdAtSlack: nextHidden(-1, 30, 0, 7),
			cappedAtMax: nextHidden(-200, 30, 5, 7),
			atMax: nextHidden(-200, 30, 7, 7),
			revealCappedAtHidden: nextHidden(500, 30, 2, 7),
			defaultMax: nextHidden(-1000, 30, 0),
		}).toStrictEqual({
			hideTwo: 2,
			revealOne: -1,
			holdBelowReveal: 0,
			holdAtSlack: 0,
			cappedAtMax: 2,
			atMax: 0,
			revealCappedAtHidden: -2,
			defaultMax: 6,
		});
	});

	it("lets the title keep up to 100px of its natural width", () => {
		expect({
			longTitle: freeAfterTitle({freePx: 0, titleClientPx: 60, titleNaturalPx: 300, shortfallPx: 0}),
			shortTitle: freeAfterTitle({freePx: 10, titleClientPx: 40, titleNaturalPx: 40, shortfallPx: 0}),
			shortfall: freeAfterTitle({freePx: 0, titleClientPx: 120, titleNaturalPx: 300, shortfallPx: 5}),
		}).toStrictEqual({longTitle: -40, shortTitle: 10, shortfall: 15});
	});

	it("counts the title spilling past its cluster and the last child spilling past the row", () => {
		expect({
			none: overflowShortfall({titleEnd: 100, leadEnd: 120, lastEnd: 300, rowEnd: 310}),
			both: overflowShortfall({titleEnd: 130, leadEnd: 120, lastEnd: 320, rowEnd: 310}),
			unknown: overflowShortfall({titleEnd: 130, leadEnd: undefined, lastEnd: undefined, rowEnd: 310}),
		}).toStrictEqual({none: 0, both: 20, unknown: 0});
	});
});

describe("pillsCompact (upstream qt)", () => {
	const base = {freePx: 0, titleClientPx: 50, titleNaturalPx: 100, hidden: 0, pillBudget: 0, pillBudgetAtCollapse: 0};

	it("compacts once there is no free space and the title truncates", () => {
		expect({
			truncatedNoFree: pillsCompact(false, base),
			halfPixelFree: pillsCompact(false, {...base, freePx: 0.5}),
			someFree: pillsCompact(false, {...base, freePx: 1}),
			titleWhole: pillsCompact(false, {...base, titleClientPx: 100}),
		}).toStrictEqual({truncatedNoFree: true, halfPixelFree: true, someFree: false, titleWhole: false});
	});

	it("re-expands only with nothing hidden, the pill budget grown past 1px, and 96px free", () => {
		const roomy = {...base, freePx: 96, pillBudget: 2, pillBudgetAtCollapse: 0};
		expect({
			roomy: pillsCompact(true, roomy),
			hidden: pillsCompact(true, {...roomy, hidden: 1}),
			budgetFlat: pillsCompact(true, {...roomy, pillBudget: 1}),
			tight: pillsCompact(true, {...roomy, freePx: 95}),
		}).toStrictEqual({roomy: false, hidden: true, budgetFlat: true, tight: true});
	});
});

describe("foldPass (upstream Jt's measure step)", () => {
	const rest: FoldState = {hidden: 0, compact: false, pillBudgetAtCollapse: -Infinity, compactedThisBurst: false};

	it("compacts the pills and hides buttons when the title drops under 100px", () => {
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
				7,
			),
		).toStrictEqual({hidden: 2, compact: true, pillBudgetAtCollapse: -80, compactedThisBurst: true});
	});

	it("refuses to re-expand the pills in the same burst that compacted them", () => {
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
				{hidden: 0, compact: true, pillBudgetAtCollapse: -80, compactedThisBurst: true},
				7,
			),
		).toStrictEqual({hidden: 0, compact: true, pillBudgetAtCollapse: 324, compactedThisBurst: true});
	});

	it("re-expands after the burst settles and reveals hidden buttons when there is room", () => {
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
				{hidden: 0, compact: true, pillBudgetAtCollapse: -80, compactedThisBurst: false},
				7,
			),
		).toStrictEqual({hidden: 0, compact: false, pillBudgetAtCollapse: -Infinity, compactedThisBurst: false});
	});
});
