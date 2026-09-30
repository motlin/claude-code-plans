import {describe, expect, it} from "vite-plus/test";
import {formatResultsTable, rewriteCeilings} from "../../scripts/perf-ceilings";
import type {Ceilings} from "./ratchet";

const ceilings: Ceilings = {
	"b.lowered": {ceiling: 1000, unit: "bytes", tolerance: 0},
	"c.raised": {ceiling: 5, unit: "count", tolerance: 0},
	"d.same": {ceiling: 7, unit: "calls", tolerance: 0},
	"e.unmeasured": {ceiling: 3, unit: "count", tolerance: 0, reason: "bigger fixture", raisedAt: "2026-09-01"},
};

describe("rewriteCeilings", () => {
	it("lowers dropped ids, adds new ids, leaves raised ids alone and sorts the keys", () => {
		const results = {
			"z.new": {value: 12},
			"a.new": {value: 4, unit: "ms"},
			"b.lowered": {value: 800, unit: "bytes"},
			"c.raised": {value: 9, unit: "count"},
			"d.same": {value: 7, unit: "calls"},
		};

		const rewrite = rewriteCeilings(ceilings, results);

		expect(rewrite).toStrictEqual({
			ceilings: {
				"a.new": {ceiling: 4, unit: "ms", tolerance: 0},
				"b.lowered": {ceiling: 800, unit: "bytes", tolerance: 0},
				"c.raised": {ceiling: 5, unit: "count", tolerance: 0},
				"d.same": {ceiling: 7, unit: "calls", tolerance: 0},
				"e.unmeasured": {
					ceiling: 3,
					unit: "count",
					tolerance: 0,
					reason: "bigger fixture",
					raisedAt: "2026-09-01",
				},
				"z.new": {ceiling: 12, unit: "count", tolerance: 0},
			},
			changes: [
				{id: "a.new", kind: "added", from: undefined, to: 4},
				{id: "b.lowered", kind: "lowered", from: 1000, to: 800},
				{id: "c.raised", kind: "raised", from: 5, to: 9},
				{id: "z.new", kind: "added", from: undefined, to: 12},
			],
		});
		expect(Object.keys(rewrite.ceilings)).toStrictEqual([
			"a.new",
			"b.lowered",
			"c.raised",
			"d.same",
			"e.unmeasured",
			"z.new",
		]);
	});

	it("drops a stale reason and raisedAt when a raised ceiling is lowered again", () => {
		const rewrite = rewriteCeilings(ceilings, {"e.unmeasured": {value: 2, unit: "count"}});

		expect(rewrite.ceilings["e.unmeasured"]).toStrictEqual({ceiling: 2, unit: "count", tolerance: 0});
		expect(rewrite.changes).toStrictEqual([{id: "e.unmeasured", kind: "lowered", from: 3, to: 2}]);
	});
});

describe("formatResultsTable", () => {
	it("prints each measured id with its value, ceiling and status", () => {
		const table = formatResultsTable(ceilings, {
			"a.new": {value: 4, unit: "ms"},
			"b.lowered": {value: 800, unit: "bytes"},
			"c.raised": {value: 9, unit: "count"},
			"d.same": {value: 7, unit: "calls"},
		});

		expect(table.split("\n")).toStrictEqual([
			"id         value  ceiling  unit   status",
			"a.new          4        -  ms     new",
			"b.lowered    800     1000  bytes  lowered",
			"c.raised       9        5  count  raised",
			"d.same         7        7  calls  ok",
		]);
	});

	it("says so when nothing was measured", () => {
		expect(formatResultsTable(ceilings, {})).toBe("No perf results recorded.");
	});
});
