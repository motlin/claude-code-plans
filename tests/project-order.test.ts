import {describe, expect, it} from "vite-plus/test";

import
{
	compareProjectNames,
	mergeProjectOrder,
	moveProjectIndex,
	moveProjectKey,
	normalizeProjectOrder,
	projectSortMode,
} from "../src/lib/project-order";

describe("project order model (upstream L8, Hd, Dx, _e, Jm, eL)", () =>
{
	it("normalizes, picks the sort mode, moves and merges like upstream", () =>
	{
		expect(
			{
				normalized: normalizeProjectOrder(["b", "a", "b", 3, null]),
				notArray: normalizeProjectOrder("x"),
				staleIsName: projectSortMode(["gone"], new Set(["a"])),
				presentIsManual: projectSortMode(["gone", "a"], new Set(["a"])),
				dragged: moveProjectKey(["a", "b", "c"], "c", "a"),
				draggedOntoSelf: moveProjectKey(["a"], "a", "a"),
				draggedMissing: moveProjectKey(["a", "b"], "a", "z"),
				movedDown: moveProjectIndex(["a", "b", "c"], 0, 1),
				movedOutOfBounds: moveProjectIndex(["a", "b"], 1, 2),
				mergedFresh: mergeProjectOrder([], ["a", "b", "c"], ["b", "a", "c"]),
				hiddenKeepSlots: mergeProjectOrder(["x", "a", "y", "b"], ["a", "b"], ["b", "a"]),
				unstoredSlotIn: mergeProjectOrder(["a"], ["n", "a", "m"], ["a", "n", "m"]),
				numericNames: ["app10", "Beta", "app2", "alpha"].toSorted(compareProjectNames),
				codeUnitTie: ["b", "B"].toSorted(compareProjectNames),
			},
		).toStrictEqual(
			{
				normalized: ["b", "a"],
				notArray: [],
				staleIsName: "name",
				presentIsManual: "manual",
				dragged: ["c", "a", "b"],
				draggedOntoSelf: null,
				draggedMissing: null,
				movedDown: ["b", "a", "c"],
				movedOutOfBounds: null,
				mergedFresh: ["b", "a", "c"],
				hiddenKeepSlots: ["x", "b", "y", "a"],
				unstoredSlotIn: ["a", "n", "m"],
				numericNames: ["alpha", "app2", "app10", "Beta"],
				codeUnitTie: ["b", "B"],
			},
		);
	});
});
